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

enum StatType {
  GENRES = 'genres',
  ARTISTS = 'artists',
  ALBUMS = 'albums',
  TRACKS = 'tracks'
}

const getAllData = async (statsfmUserId: string, range: Range) => {
  const genres = await getPaginatedData<TopGenre[]>(StatType.GENRES, statsfmUserId, range);
  const artists = await getPaginatedData<TopArtist[]>(StatType.ARTISTS, statsfmUserId, range);
  const albums = await getPaginatedData<TopAlbum[]>(StatType.ALBUMS, statsfmUserId, range);
  const tracks = await getPaginatedData<TopTrack[]>(StatType.TRACKS, statsfmUserId, range);

  return {
    genres,
    artists,
    albums,
    tracks
  };
};

const getPaginatedData = async <T>(statType: StatType, statsfmUserId: string, range: Range) => {
  const limit = 1000;
  const orderBy = 'TIME';

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

    if (data.length === 0 || offset >= 10000) break;
  }

  return allData;
};

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
    // let genres: TopGenre[];
    // let artists: TopArtist[];
    // let albums: TopAlbum[];
    // let tracks: TopTrack[];

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
        content: `Fetching Meme Data: ${layla.userId}`,
        ephemeral: true
      });
      const laylaData = await getAllData(layla.userId, Range.LIFETIME);
      respond(interaction, {
        content: `Fetching Layla Data: ${layla.userId}`,
        ephemeral: true
      });
      const selfData = await getAllData(statsfmUser.id, Range.LIFETIME);

      // artists = await statsfmApi.users.(statsfmUser.id, {
      //   range: Range.WEEKS
      // });

      logger.debug(`Top genres length: ${selfData.genres.length}`);
      // logger.debug(`Top genre: ${JSON.stringify(genres.slice(0, 5))}`);

      logger.debug(`Top artists length: ${selfData.artists.length}`);
      // logger.debug(`Top artists: ${JSON.stringify(artists.slice(0, 5))}`);

      logger.debug(`Top albums length: ${selfData.albums.length}`);
      // logger.debug(`Top albums: ${JSON.stringify(albums.slice(0, 5))}`);

      logger.debug(`Top tracks length: ${selfData.tracks.length}\n`);
      // logger.debug(`Top tracks: ${JSON.stringify(tracks.slice(0, 5))}`);

      logger.debug(`Top genres length layla: ${laylaData.genres.length}`);
      // logger.debug(`Top genre: ${JSON.stringify(genres.slice(0 layla, 5))}`);

      logger.debug(`Top artists length layla: ${laylaData.artists.length}`);
      // logger.debug(`Top artists: ${JSON.stringify(artists.slice(0, 5))}`);

      logger.debug(`Top albums length layla: ${laylaData.albums.length}`);
      // logger.debug(`Top albums: ${JSON.stringify(albums.slice(0, 5))}`);

      logger.debug(`Top tracks length layla: ${laylaData.tracks.length}`);
      // logger.debug(`Top tracks: ${JSON.stringify(tracks.slice(0, 5))}`);
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
