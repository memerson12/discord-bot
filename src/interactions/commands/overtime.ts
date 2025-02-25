import { ApplicationCommandOptionType } from 'discord.js';
import {
  ApplicationIntegrationType,
  CommandPayload,
  InteractionContextType,
  StringChoiceOption,
  UserOption
} from '../../util/SlashCommandUtils';
import { rangeChoices } from '../utils';

// TODO: Extract this to a shared file
function createRangeOptionForTop<T extends string>(type: T) {
  return {
    type: ApplicationCommandOptionType.String,
    description: `The range of which you want to see ${type} over time of`,
    choices: rangeChoices(false)
  } as const satisfies StringChoiceOption<false>;
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
      description:
        'The artist you want to get info about, you can use to use names and stats.fm links'
    },
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
