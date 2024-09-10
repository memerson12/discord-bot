import { Api, Range } from '@statsfm/statsfm.js';
// import { APIEmbedField, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { container } from 'tsyringe';

import type { Logger } from '../util/Logger';
import { kLogger } from '../util/tokens';

import { AffinityCommand } from '../interactions';
import { Analytics } from '../util/Analytics';
import { createCommand } from '../util/Command';
import { createEmbed, notLinkedEmbed, privacyEmbed } from '../util/embed';
import RBO from '../util/RankedBasedOverlap';

import { getStatsfmUserFromDiscordUser } from '../util/getStatsfmUserFromDiscordUser';
import { PrivacyManager } from '../util/PrivacyManager';
import {
  TopAlbum,
  TopArtist,
  TopGenre,
  TopTrack
} from '@statsfm/statsfm.js/dist/interfaces/statsfm/v1';
import { createPaginationComponentTypes, createPaginationManager } from '../util/PaginationManager';
import { StatsfmUser } from '../util/StatsfmUser';
import * as fs from 'fs';
import * as path from 'path';

const statsfmApi = container.resolve(Api);
const privacyManager = container.resolve(PrivacyManager);
const analytics = container.resolve(Analytics);
const logger = container.resolve<Logger>(kLogger);
const AffinityComponents = createPaginationComponentTypes('affinities');

const AffinityConstants = {
  guildMemberBatchSize: 50000,
  statusMessages: {
    fetchingServerMembers:
      'Fetching server members...\n-# Due to stat.fm limitations, this will take a while.',
    fetchingServerMembersCount: (count: number, total: number) =>
      `Getting server members... (${count}/${total})\n-# Due to stat.fm limitations, this will take a while.`,
    fetchingTopListeners: 'Fetching All Stats.fm Users in the Server... This can take a while.'
  }
};

type Category = 'tracks' | 'artists' | 'albums' | 'genres';
// interface GetUserByDiscordIdResponse {
//   id: number;
//   verified: boolean;
//   userId: string;
// }

interface DiscordUser {
  displayName: string;
  user: StatsfmUser;
}

interface Affinities {
  overallRank: number;
  user: DiscordUser;
  rbo: Record<StatType, string>;
  pac: Record<StatType, string>;
}
interface UserData {
  genres: string[];
  artists: string[];
  albums: string[];
  tracks: string[];
}

enum StatType {
  GENRES = 'genres',
  ARTISTS = 'artists',
  ALBUMS = 'albums',
  TRACKS = 'tracks'
}

const getAllData = async (statsfmUserId: string, range: Range): Promise<UserData> => {
  const genresPromise = getPaginatedData<TopGenre>(StatType.GENRES, statsfmUserId, range);
  const artistsPromise = getPaginatedData<TopArtist>(StatType.ARTISTS, statsfmUserId, range);
  const albumsPromise = getPaginatedData<TopAlbum>(StatType.ALBUMS, statsfmUserId, range);
  const tracksPromise = getPaginatedData<TopTrack>(StatType.TRACKS, statsfmUserId, range);
  const [genres, artists, albums, tracks] = await Promise.all([
    genresPromise,
    artistsPromise,
    albumsPromise,
    tracksPromise
  ]);
  return {
    genres: mapDataToIds(genres),
    artists: mapDataToIds(artists),
    albums: mapDataToIds(albums),
    tracks: mapDataToIds(tracks)
  };
};

const getPaginatedData = async <T>(statType: StatType, statsfmUserId: string, range: Range) => {
  const limit = 500;
  const orderBy = 'TIME';
  const total = 5000;

  let offset = 0;
  const allData: T[] = [];

  while (true) {
    const data = (
      await statsfmApi.http.get<{ items: T[] }>(`/users/${statsfmUserId}/top/${statType}`, {
        query: {
          limit,
          offset,
          orderBy,
          range
        }
      })
    ).items;

    allData.push(...data);
    offset += limit;

    if (data.length === 0 || offset >= 5000 || allData.length >= total) break;
  }

  return allData;
};

const categoryWeights: Record<Category, number> = {
  tracks: 1,
  artists: 1,
  albums: 1,
  genres: 1
};

const mapDataToIds = (data: TopGenre[] | TopArtist[] | TopAlbum[] | TopTrack[]): string[] => {
  return data.map((item) => {
    if ('genre' in item) {
      return item.genre.tag;
    } else if ('artist' in item) {
      return item.artist.id.toString();
    } else if ('album' in item) {
      return item.album.id.toString();
    } else {
      return item.track.id.toString();
    }
  });
};

const pacMethod = (user1: UserData, user2: UserData): Record<StatType, string> => {
  const similarities: Record<StatType, string> = {
    genres: '0',
    artists: '0',
    albums: '0',
    tracks: '0'
  };
  for (const category of Object.keys(categoryWeights) as Category[]) {
    const user1List = user1[category];
    const user2List = user2[category];

    const weightsAndDifferences: Array<Array<number>> = [];
    let totalWeight = 0;

    user1List.forEach((item, rank) => {
      const otherRank = user2List.indexOf(item);
      const differenceFactor =
        otherRank === -1
          ? 1
          : Math.abs(rank - otherRank) / (Math.max(user1List.length, user1List.length) - 1);
      const weight = user1List.length - rank + 1;
      totalWeight += weight;
      weightsAndDifferences.push([weight, differenceFactor]);
    });

    let total = 0;
    weightsAndDifferences.forEach(([weight, differenceFactor]) => {
      total += (weight / totalWeight) * differenceFactor;
    });

    logger.info(`${category}: ${1 - total}`);
    let result = (1 - total) * 100;
    if (result < 0 && result > -0.5) {
      result = 0;
    }
    similarities[category] = result.toFixed(0);
  }
  return similarities;
};

const calculateRBO = (user1: UserData, user2: UserData): Record<StatType, string> => {
  const similarities: Record<StatType, string> = {
    genres: '0',
    artists: '0',
    albums: '0',
    tracks: '0'
  };
  for (const category of Object.keys(categoryWeights) as Category[]) {
    const user1List = user1[category];
    const user2List = user2[category];

    const rbo = new RBO(0.99).calculate(user1List, user2List);
    logger.info(`${category}: ${rbo}`);
    similarities[category] = (rbo * 100).toFixed(0);
  }
  return similarities;
};

export default createCommand(AffinityCommand)
  .registerChatInput(async ({ interaction, args, statsfmUser: statsfmUserSelf, respond }) => {
    await interaction.deferReply();
    const targetUser = interaction.user;
    const statsfmUser =
      targetUser === interaction.user
        ? statsfmUserSelf
        : await getStatsfmUserFromDiscordUser(targetUser);
    if (!statsfmUser) {
      await analytics.track('PROFILE_target_user_not_linked');
      return respond(interaction, {
        embeds: [notLinkedEmbed(targetUser)]
      });
    }

    if (!interaction.guild || !interaction.guildId) {
      return respond(interaction, {
        content: 'This command can only be used in a server.'
      });
    }

    const privacySettingCheck = privacyManager.doesHaveMatchingPrivacySettings(
      'profile',
      statsfmUser.privacySettings
    );
    if (!privacySettingCheck) {
      await analytics.track('PROFILE_privacy');
      return respond(interaction, {
        embeds: [
          privacyEmbed(targetUser, privacyManager.getPrivacySettingsMessage('profile', 'profile'))
        ]
      });
    }

    let range = Range.WEEKS;
    let rangeDisplay = 'Past 4 Weeks';

    if (args.range === '6-months') {
      range = Range.MONTHS;
      rangeDisplay = 'Past 6 Months';
    }
    if (args.range === 'lifetime') {
      range = Range.LIFETIME;
      rangeDisplay = 'Lifetime';
    }

    try {
      // const layla = await statsfmApi.http
      //   .get<GetUserByDiscordIdResponse>(`/private/get-user-by-discord-id`, {
      //     query: {
      //       id: '222453926685966336'
      //     }
      //   })
      //   .catch(() => null);
      // const snail = await statsfmApi.http
      //   .get<GetUserByDiscordIdResponse>(`/private/get-user-by-discord-id`, {
      //     query: {
      //       id: '861648226905489438'
      //     }
      //   })
      //   .catch(() => null);

      // if (!layla || !snail) {
      //   // throw new Error('Layla not found');
      //   return;
      // }

      // respond(interaction, {
      //   embeds: [
      //     createEmbed()
      //       .setTimestamp()
      //       .setDescription(
      //         `<a:loading:821676038102056991> Loading ${statsfmUser.displayName}'s data...`
      //       )
      //       .toJSON()
      //   ]
      // });
      // const selfDataPromise = getAllData(statsfmUser.id, Range.LIFETIME);
      // respond(interaction, {
      //   embeds: [
      //     createEmbed()
      //       .setTimestamp()
      //       .setDescription(`<a:loading:821676038102056991> Loading Layla's data...`)
      //       .toJSON()
      //   ]
      // });
      // const laylaDataPromise = getAllData(layla.userId, Range.LIFETIME);

      // logger.info('Fetching data...');
      // const [selfData, laylaData] = await Promise.all([selfDataPromise, laylaDataPromise]);

      // logger.info('Calculating affinity...');
      // const affinity = pacMethod(selfData, laylaData);
      // logger.info(`Affinity: ${affinity}\n`);

      // logger.info('Calculating RBO...');
      // const rboAffnities = {
      //   tracks: (new RBO(0.99).calculate(selfData.tracks, laylaData.tracks) * 100).toFixed(0),
      //   artists: (new RBO(0.99).calculate(selfData.artists, laylaData.artists) * 100).toFixed(0),
      //   albums: (new RBO(0.99).calculate(selfData.albums, laylaData.albums) * 100).toFixed(0),
      //   genres: (new RBO(0.99).calculate(selfData.genres, laylaData.genres) * 100).toFixed(0)
      // };
      // logger.info(`RBO: ${JSON.stringify(rboAffnities)}\n`);
      // } catch (e: any) {
      //   logger.error(e);
      // }

      await respond(interaction, {
        content: AffinityConstants.statusMessages.fetchingServerMembers
      });
      const members: DiscordUser[] = [];
      const guildMembers = await interaction.guild.members.fetch();
      logger.info(`Fetched ${guildMembers.size} members`);
      for (let i = 0; i < guildMembers.size; i++) {
        const data = Array.from(guildMembers)[i][1];
        if (data.user.bot) continue;
        const user = await getStatsfmUserFromDiscordUser(data.user);
        if (user && user.id !== statsfmUser.id) {
          members.push({
            displayName: data.displayName,
            user
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
        await respond(interaction, {
          content: AffinityConstants.statusMessages.fetchingServerMembersCount(i, guildMembers.size)
        });
      }
      logger.info(
        `Fetched ${members.length} members\n${members.map((m) => m.displayName).join('\n')}`
      );

      const affinities: Affinities[] = [];
      const selfData = await getAllData(statsfmUser.id, range);

      // members.push(
      //   {
      //     displayName: 'Layla',
      //     user: getStatsfmUserFromDiscordUser()
      //   },
      //   {
      //     displayName: 'Snail',
      //     user: snail
      //   }
      // );

      if (members.length === 0) {
        return respond(interaction, {
          content: 'No other Stats.fm users in this server.'
        });
      }

      for (const member of members) {
        await respond(interaction, {
          content: `Fetching data for ${member.displayName}...`
        });
        const memberData = await getAllData(member.user.id, range).catch(() => null);
        if (!memberData) {
          logger.warn(`Failed to fetch data for ${member.displayName}`);
          continue;
        }
        // if (
        //   member.displayName === 'Fevenir' ||
        //   member.displayName === 'shig' ||
        //   member.displayName === 'lizzie'
        // ) {
        logger.info(`Writing data for ${member.displayName}`);
        const filePath = path.join(__dirname, `${member.displayName}.json`);
        fs.writeFileSync(filePath, JSON.stringify(memberData, null, 2));
        // }
        const pac = pacMethod(selfData, memberData);
        const rbo = calculateRBO(selfData, memberData);
        affinities.push({
          overallRank: 0,
          user: member,
          rbo,
          pac
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // await analytics.track('PROFILE');

      const pagination = createPaginationManager(affinities, (currPage, totalPages, currData) => {
        // eslint-disable-next-line prettier/prettier
        return createEmbed()
          .setAuthor({
            name: `${targetUser.displayName}'s ${rangeDisplay} Affinities`,
            url: statsfmUser.profileUrl
          })
          .setDescription(
            currData
              .map((affinityData) => {
                let sorryMarie = '';
                if (affinityData.user.displayName === 'dfop[gbuwivyfgeaifgw4biu23g') {
                  sorryMarie =
                    '\n-# Sorry Marie, I tried but discord is dumb so i can make your full name link properly';
                }
                const userUrl = affinityData.user.user.profileUrl;
                return `
              ${affinityData.overallRank}. [${affinityData.user.displayName}](${userUrl}) • 
                \n**Method 1:** **${affinityData.pac.genres}%** genres, **${affinityData.pac.artists}%** artists, **${affinityData.pac.albums}%** albums, **${affinityData.pac.tracks}%** tracks
                **Method 2:** **${affinityData.rbo.genres}%** genres, **${affinityData.rbo.artists}%** artists, **${affinityData.rbo.albums}%** albums, **${affinityData.rbo.tracks}%** tracks${sorryMarie}`;
              })
              .join('\n')
          )
          .setFooter({ text: `Page ${currPage}/${totalPages}` });
      });

      const message = await respond(
        interaction,
        pagination.createMessage<'reply'>(await pagination.current(), AffinityComponents)
      );

      pagination.manageCollector(message, AffinityComponents, interaction.user);

      return message;
    } catch (e: any) {
      logger.error(e);
      return respond(interaction, {
        content: 'An error occurred while fetching data.'
      });
    }
  })
  .build();
