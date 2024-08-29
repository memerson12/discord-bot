import { Api, Range, StreamStats } from '@statsfm/statsfm.js';
import { APIEmbedField, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { container } from 'tsyringe';

import type { Logger } from '../util/Logger';
import { kLogger } from '../util/tokens';

import { AffinityCommand } from '../interactions';
import { Analytics } from '../util/Analytics';
import { createCommand } from '../util/Command';
import { createEmbed, notLinkedEmbed, privacyEmbed } from '../util/embed';

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

interface GetUserByDiscordIdResponse {
  id: number;
  verified: boolean;
  userId: string;
}

interface UserData {
  genres: TopGenre[];
  artists: TopArtist[];
  albums: TopAlbum[];
  tracks: TopTrack[];
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
    genres,
    artists,
    albums,
    tracks
  };
};

const getPaginatedData = async <T>(statType: StatType, statsfmUserId: string, range: Range) => {
  const limit = 500;
  const orderBy = 'TIME';
  const total = 500;

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

const compareDataPercent = (selfData: UserData, otherData: UserData) => {
  const genres = compareItemsPercent(selfData.genres, otherData.genres, 'genre');
  const artists = compareItemsPercent(selfData.artists, otherData.artists, 'artist');
  const albums = compareItemsPercent(selfData.albums, otherData.albums, 'album');
  const tracks = compareItemsPercent(selfData.tracks, otherData.tracks, 'track');
  return {
    genres,
    artists,
    albums,
    tracks
  };
};

const compareDataPoints = (selfData: UserData, otherData: UserData) => {
  const genres = compareItemsPoints(selfData.genres, otherData.genres, 'genre');
  const artists = compareItemsPoints(selfData.artists, otherData.artists, 'artist');
  const albums = compareItemsPoints(selfData.albums, otherData.albums, 'album');
  const tracks = compareItemsPoints(selfData.tracks, otherData.tracks, 'track');

  return {
    genres,
    artists,
    albums,
    tracks
  };
};

const compareItemsPercent = <T extends Record<string, any>>(
  selfItems: T[],
  otherItems: T[],
  field: keyof T
) => {
  const identifierKey = field === 'genre' ? 'tag' : 'id';
  const all = new Set();
  const overlap = selfItems.filter((selfItem) => {
    all.add(selfItem[field][identifierKey]);
    return otherItems.some(
      (otherItem) => otherItem[field][identifierKey] === selfItem[field][identifierKey]
    );
  });
  return overlap.length / all.size;
};

const compareItemsPoints = <T extends Record<string, any>>(
  selfItems: T[],
  otherItems: T[],
  field: keyof T
) => {
  const identifierKey = field === 'genre' ? 'tag' : 'id';

  //Generate postion maps
  const selfMap = new Map(selfItems.map((item, index) => [item[field][identifierKey], index]));
  const otherMap = new Map(otherItems.map((item, index) => [item[field][identifierKey], index]));

  //Calculate points
  let points = 0;
  for (const selfItem of selfItems) {
    const otherIndex = otherMap.get(selfItem[field][identifierKey]);
    if (otherIndex !== undefined) {
      points += addPoints(selfMap.get(selfItem[field][identifierKey]) ?? 0, otherIndex);
    }
  }
  return points;
};

function addPoints(ownPosition: number, otherPosition: number): number {
  if (otherPosition <= 5) {
    if (ownPosition <= 5) return 32;
    if (ownPosition <= 10) return 18;
    if (ownPosition <= 25) return 12;
    if (ownPosition <= 40) return 6;
    if (ownPosition <= 60) return 3;
    if (ownPosition <= 120) return 2;
    return 1;
  }
  if (otherPosition <= 10) {
    if (ownPosition <= 10) return 18;
    if (ownPosition <= 25) return 12;
    if (ownPosition <= 40) return 6;
    if (ownPosition <= 60) return 4;
    if (ownPosition <= 120) return 2;
    return 1;
  }
  if (otherPosition <= 25) {
    if (ownPosition <= 25) return 12;
    if (ownPosition <= 40) return 6;
    if (ownPosition <= 60) return 4;
    if (ownPosition <= 120) return 2;
    return 1;
  }
  if (otherPosition <= 40) {
    if (ownPosition <= 40) return 6;
    if (ownPosition <= 60) return 4;
    if (ownPosition <= 120) return 2;
    return 1;
  }
  if (otherPosition <= 60) {
    if (ownPosition <= 60) return 4;
    if (ownPosition <= 120) return 2;
    return 1;
  }
  if (otherPosition <= 120) {
    if (ownPosition <= 120) return 2;
    return 1;
  }
  return 1;
}

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

      logger.info('Calculating percent...');
      const percent = compareDataPercent(selfData, laylaData);
      logger.info(`Percent: ${JSON.stringify(percent)}\n`);

      logger.info('Calculating points...');
      const points = compareDataPoints(selfData, laylaData);
      logger.info(`Points: ${JSON.stringify(points)}\n\n`);

      logger.info('Calculating percent Swap...');
      const percentSwap = compareDataPercent(laylaData, selfData);
      logger.info(`Percent Swap: ${JSON.stringify(percentSwap)}\n`);

      logger.info('Calculating points Swap...');
      const pointsSwap = compareDataPoints(laylaData, selfData);
      logger.info(`Points Swap: ${JSON.stringify(pointsSwap)}\n\n`);

      logger.info(
        `${(pointsSwap.albums / points.albums) * 2} ${(pointsSwap.artists / points.artists) * 2} ${(pointsSwap.genres / points.genres) * 2} ${(pointsSwap.tracks / points.tracks) * 2}`
      );
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
