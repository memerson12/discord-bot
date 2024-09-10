import { ApplicationCommandOptionType } from 'discord.js';
import {
  ApplicationIntegrationType,
  CommandPayload,
  InteractionContextType,
  StringChoiceOption
} from '../../util/SlashCommandUtils';
import { rangeChoices } from '../utils';

function createRangeOptionForAffinity() {
  return {
    type: ApplicationCommandOptionType.String,
    description: `The range to compare music affinity with`,
    choices: rangeChoices(false)
  } as const satisfies StringChoiceOption<false>;
}

export const AffinityCommand = {
  name: 'affinity',
  description: 'Shows music affinity with other users.',
  options: {
    range: createRangeOptionForAffinity()
  },
  contexts: [InteractionContextType.Guild, InteractionContextType.PrivateChannel],
  integration_types: [ApplicationIntegrationType.GuildInstall]
} as const satisfies CommandPayload;
