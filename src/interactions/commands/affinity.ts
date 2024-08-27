import { ApplicationCommandOptionType } from 'discord.js';
import {
  ApplicationIntegrationType,
  CommandPayload,
  InteractionContextType
} from '../../util/SlashCommandUtils';

export const AffinityCommand = {
  name: 'affinity',
  description: 'Shows music affinity with other users.',
  options: {
    user: {
      description: 'User',
      type: ApplicationCommandOptionType.User
    }
  },
  contexts: [InteractionContextType.Guild, InteractionContextType.PrivateChannel],
  integration_types: [ApplicationIntegrationType.GuildInstall]
} as const satisfies CommandPayload;
