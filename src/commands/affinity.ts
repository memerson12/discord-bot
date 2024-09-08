import { Api, Range, StreamStats } from '@statsfm/statsfm.js';
import { APIEmbedField, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
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

const statsfmApi = container.resolve(Api);
const privacyManager = container.resolve(PrivacyManager);
const analytics = container.resolve(Analytics);
const logger = container.resolve<Logger>(kLogger);

type Category = 'tracks' | 'artists' | 'albums' | 'genres';
interface GetUserByDiscordIdResponse {
  id: number;
  verified: boolean;
  userId: string;
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
  const genres = await getPaginatedData<TopGenre>(StatType.GENRES, statsfmUserId, range);
  const artists = await getPaginatedData<TopArtist>(StatType.ARTISTS, statsfmUserId, range);
  const albums = await getPaginatedData<TopAlbum>(StatType.ALBUMS, statsfmUserId, range);
  const tracks = await getPaginatedData<TopTrack>(StatType.TRACKS, statsfmUserId, range);

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
  const total = 500000;

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

    if (data.length === 0 || offset >= 10000 || allData.length >= total) break;
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

// Function to calculate normalized weight based on rank
// function getWeight(list: string[], item: string, itemRank?: number): number {
//   const rank = itemRank ?? list.indexOf(item);
//   if (rank === -1) return 0;
//   const percntile = rank / list.length;
//   switch (true) {
//     case percntile <= 0.01:
//       return 1;
//     case percntile <= 0.05:
//       return 0.9;
//     case percntile <= 0.1:
//       return 0.8;
//     case percntile <= 0.25:
//       return 0.7;
//     case percntile <= 0.5:
//       return 0.5;
//     case percntile <= 0.75:
//       return 0.3;
//     case percntile <= 0.9:
//       return 0.2;
//   }
//   return 0.1;

//   // return rank >= 0 ? 1 - rank / list.length : 0;
// }

// const getPacWeight = (rank: number): number => {};

const pacMethod = (user1: UserData, user2: UserData): Array<number> => {
  const similiarites: Array<number> = [];
  for (const category of Object.keys(categoryWeights) as Category[]) {
    const user1List = user1[category];
    const user2List = user2[category];

    const weightsAndDifferences: Array<Array<number>> = [];
    let totalWeight = 0;

    user1List.forEach((item, rank) => {
      const otherRank = user2List.indexOf(item);
      // if (otherRank === -1) return;
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
    similiarites.push(1 - total);
  }
  return similiarites;
};

function calculateRBO(user1: UserData, user2: UserData, p: number = 0.9): void {
  for (const category of Object.keys(categoryWeights) as Category[]) {
    const user1Ranking = user1[category];
    const user2Ranking = user2[category];

    const len1 = user1Ranking.length;
    const len2 = user2Ranking.length;
    const maxDepth = Math.max(len1, len2); // The depth we'll go down the list

    let rboScore = 0;
    let overlap = 0; // Keeps track of the number of common items at each depth
    const seenItems = new Set<string>();

    // Iterate through the ranks to compute the overlap at each depth
    for (let d = 1; d <= maxDepth; d++) {
      const item1 = d <= len1 ? user1Ranking[d - 1] : null;
      const item2 = d <= len2 ? user2Ranking[d - 1] : null;

      // Update the set of seen items
      if (item1 && seenItems.has(item1)) {
        overlap++;
      } else if (item1) {
        seenItems.add(item1);
      }

      if (item2 && seenItems.has(item2)) {
        overlap++;
      } else if (item2) {
        seenItems.add(item2);
      }

      // Calculate the weighted overlap for this depth
      const weight = Math.pow(p, d - 1);
      rboScore += (overlap / (2 * d)) * weight;
    }

    // Multiply the score by (1 - p) to normalize
    logger.info(`${category}: ${(1 - p) * rboScore}`);
  }
}

const kendallsW = (user1: UserData, user2: UserData): void => {
  for (const category of Object.keys(categoryWeights) as Category[]) {
    const user1List = user1[category];
    const user2List = user2[category];

    const user1Ranks = getRanks(user1List, user1List);
    const user2Ranks = getRanks(user2List, user1List);

    const n = user1Ranks.length;

    if (n !== user2Ranks.length) {
      throw new Error('Both rankings must have the same number of items');
    }

    // Calculate the difference in ranks (D) for each item
    let sumOfSquaredDifferences = 0;
    for (let i = 0; i < n; i++) {
      const difference = user1Ranks[i] - user2Ranks[i];
      sumOfSquaredDifferences += Math.pow(difference, 2);
    }

    // Compute Kendall's W
    const numerator = 12 * sumOfSquaredDifferences;
    const denominator = n * (Math.pow(n, 2) - 1);

    // The coefficient of concordance (W) is 1 - (numerator / denominator)
    const similiarity = 1 - numerator / denominator;
    logger.info(`${category}: ${similiarity}`);
  }
};

/**
 * Helper function to convert a sorted list into rank array
 * @param sortedItems Sorted list of items
 * @param referenceList Reference list from which rankings will be derived
 * @returns Array of ranks
 */
function getRanks(sortedItems: string[], referenceList: string[]): number[] {
  return referenceList.map((item) => sortedItems.indexOf(item) + 1);
}

// function calculateSimilarity(user1: UserData, user2: UserData): number {
//   let totalSimilarity = 0;

//   (Object.keys(categoryWeights) as Category[]).forEach((category) => {
//     // if (category !== 'genres') return;
//     const user1List = user1[category];
//     const user2List = user2[category];

//     let weightedSimilarity = 0;
//     let totalCommon = 0;

//     user1List.forEach((item, rank) => {
//       const weight1 = getWeight(user1List, item, rank);
//       const weight2 = getWeight(user2List, item);
//       // logger.info(`${item}: ${weight1} ${weight2}`);
//       if (user2List.includes(item)) {
//         weightedSimilarity += 1 - (weight2 - weight1);
//         totalCommon += weight1;
//       }
//     });
//     weightedSimilarity = weightedSimilarity / user1List.length;

//     logger.info(`Union: ${totalCommon}`);
//     // const categorySimilarity = unionSimilarity === 0 ? 0 : intersectionSimilarity / unionSimilarity;
//     const categorySimilarity = weightedSimilarity;
//     totalSimilarity += categorySimilarity * categoryWeights[category];
//     logger.info(`${category}: ${categorySimilarity}`);
//   });

//   return totalSimilarity / 4;
// }

// const percentInCommon = (user1: UserData, user2: UserData): number => {
//   let total = 0;
//   let common = 0;

//   (Object.keys(categoryWeights) as Category[]).forEach((category) => {
//     let catagoryTotal = 0;
//     let categoryCommon = 0;

//     const user1List = user1[category];
//     const user2List = user2[category];

//     user1List.forEach((item) => {
//       if (user2List.includes(item)) {
//         categoryCommon++;
//       }
//       catagoryTotal++;
//     });
//     logger.info(`${category}: ${categoryCommon / catagoryTotal}`);
//     common += categoryCommon;
//     total += catagoryTotal;
//   });

//   return common / total;
// };

export default createCommand(AffinityCommand)
  .registerChatInput(async ({ interaction, args, statsfmUser: statsfmUserSelf, respond }) => {
    await interaction.deferReply();
    const targetUser = args.user?.user ?? interaction.user;
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

    let stats: StreamStats;

    try {
      stats = await statsfmApi.users.stats(statsfmUser.id, {
        range: Range.LIFETIME
      });
      const layla = await statsfmApi.http
        .get<GetUserByDiscordIdResponse>(`/private/get-user-by-discord-id`, {
          query: {
            id: '222453926685966336'
          }
        })
        .catch(() => null);

      if (!layla) {
        // throw new Error('Layla not found');
        return;
      }

      respond(interaction, {
        embeds: [
          createEmbed()
            .setTimestamp()
            .setDescription(
              `<a:loading:821676038102056991> Loading ${statsfmUser.displayName}'s data...`
            )
            .toJSON()
        ]
      });
      const selfDataPromise = getAllData(statsfmUser.id, Range.LIFETIME);
      respond(interaction, {
        embeds: [
          createEmbed()
            .setTimestamp()
            .setDescription(`<a:loading:821676038102056991> Loading Layla's data...`)
            .toJSON()
        ]
      });
      const laylaDataPromise = getAllData(layla.userId, Range.LIFETIME);

      logger.info('Fetching data...');
      const [selfData, laylaData] = await Promise.all([selfDataPromise, laylaDataPromise]);

      // selfData = {
      //   genres: ['a', 'b', 'c', 'd'],
      //   artists: ['a', 'b', 'c', 'd'],
      //   albums: ['a', 'b', 'c', 'd'],
      //   tracks: ['a', 'b', 'c', 'd']
      // };

      // laylaData = {
      //   genres: ['a', 'b', 'c', 'd'],
      //   artists: ['d', 'c', 'b', 'a'],
      //   albums: ['a', 'b', 'c', 'd', 'e'],
      //   tracks: ['e', 'f', 'g', 'h', 'i']
      // };

      logger.info('Calculating affinity...');
      const affinity = pacMethod(selfData, laylaData);
      logger.info(`Affinity: ${affinity}\n`);

      logger.info('Calculating kendallsW...');
      kendallsW(selfData, laylaData);
      logger.info('');

      logger.info('Calculating RBO...');
      calculateRBO(selfData, laylaData);
      logger.info('');

      logger.info('Calculating Other RBO...');
      let rbo = new RBO(0.99);
      logger.info(`tracks: ${rbo.calculate(selfData.tracks, laylaData.tracks)}`);
      rbo = new RBO(0.99);
      logger.info(`artists: ${rbo.calculate(selfData.artists, laylaData.artists)}`);
      rbo = new RBO(0.99);
      logger.info(`albums: ${rbo.calculate(selfData.albums, laylaData.albums)}`);
      rbo = new RBO(0.99);
      logger.info(`genres: ${rbo.calculate(selfData.genres, laylaData.genres)}`);
      // logger.info('Calculating percent in common...');
      // const percentInCommonValue = percentInCommon(selfData, laylaData);
      // logger.info(`Percent in common: ${percentInCommonValue}\n`);

      // logger.info('Calculating percent...');
      // const percent = compareDataPercent(selfData, laylaData);
      // logger.info(`Percent: ${JSON.stringify(percent)}\n`);

      // logger.info('Calculating points...');
      // const points = compareDataPoints(selfData, laylaData);
      // logger.info(`Points: ${JSON.stringify(points)}\n\n`);

      // logger.info('Calculating percent Swap...');
      // const percentSwap = compareDataPercent(laylaData, selfData);
      // logger.info(`Percent Swap: ${JSON.stringify(percentSwap)}\n`);

      // logger.info('Calculating points Swap...');
      // const pointsSwap = compareDataPoints(laylaData, selfData);
      // logger.info(`Points Swap: ${JSON.stringify(pointsSwap)}\n\n`);

      // logger.info(
      //   `${(pointsSwap.albums / points.albums) * 2} ${(pointsSwap.artists / points.artists) * 2} ${(pointsSwap.genres / points.genres) * 2} ${(pointsSwap.tracks / points.tracks) * 2}`
      // );
    } catch (e: any) {
      logger.error(e);
      stats = {
        count: -1,
        durationMs: -1
      };
    }

    const fields: APIEmbedField[] = [
      {
        name: 'Pronouns',
        value: statsfmUser.profile?.pronouns ?? 'Not assigned',
        inline: stats.count != -1
      }
    ];

    if (stats.count != -1) {
      fields.push({
        name: 'Streams',
        value: stats.count.toLocaleString(),
        inline: true
      });
      fields.push({
        name: 'Minutes streamed',
        value: `${Math.round((stats.durationMs ?? 0) / 1000 / 60).toLocaleString()} minutes`,
        inline: true
      });
    }

    const bio = statsfmUser.profile && statsfmUser.profile.bio ? statsfmUser.profile.bio : 'No bio';

    fields.push({
      name: 'Bio',
      value: bio
    });

    await analytics.track('PROFILE');

    return respond(interaction, {
      embeds: [
        createEmbed()
          .setTimestamp()
          .setThumbnail(
            statsfmUser.image ??
              'https://cdn.stats.fm/file/statsfm/images/placeholders/users/private.web'
          )
          .setAuthor({
            name: statsfmUser.displayName
          })
          .addFields(fields)
          .toJSON()
      ],
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              label: 'View on stats.fm',
              style: ButtonStyle.Link,
              url: statsfmUser.profileUrl,
              emoji: {
                name: '🔗'
              }
            },
            ...(statsfmUser.privacySettings.connections
              ? [
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setLabel('View on Spotify')
                    .setURL(statsfmUser.profileUrlSpotify)
                    .setEmoji({
                      id: '998272544870252624'
                    })
                ]
              : [])
          ]
        }
      ]
    });
  })
  .build();
