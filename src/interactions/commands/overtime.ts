import { ApplicationCommandOptionType } from 'discord.js';
import {
  ApplicationIntegrationType,
  CommandPayload,
  InteractionContextType,
  StringAutocompleteOption,
  UserOption
} from '../../util/SlashCommandUtils';
import { TIME_RANGES } from '../utils';

// TODO: Extract this to a shared file
function createRangeOptionForTop<T extends string>(type: T) {
  return {
    type: ApplicationCommandOptionType.String,
    description: `The range of which you want to see ${type} over time of`,
    choices: TIME_RANGES
  } as const;
}

function createUserOptionForTop<T extends string>(type: T) {
  return {
    type: ApplicationCommandOptionType.User,
    description: `The user of which you want to see the ${type} over time, if not yourself`
  } as const satisfies UserOption;
}

export const OverTimeCommand = {
  name: 'overtime',
  description: 'See your stats for a specific artist over time',
  options: {
    artist: {
      type: ApplicationCommandOptionType.String,
      autocomplete: true,
      required: true,
      description: 'The artist you want to see your stats for over time vor'
    } as const satisfies StringAutocompleteOption<false>,
    range: createRangeOptionForTop('artists'),
    user: createUserOptionForTop('artists')
  },
  contexts: [
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel
  ],
  integration_types: [
    ApplicationIntegrationType.GuildInstall,
    ApplicationIntegrationType.UserInstall
  ]
} as const satisfies CommandPayload;
