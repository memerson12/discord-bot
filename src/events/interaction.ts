import {
  MessageFlags,
  InteractionReplyOptions,
  ApplicationCommandType,
  Message,
  CommandInteraction,
} from 'discord.js';
import { container } from 'tsyringe';
import type { BuildedCommand } from '../util/Command';
import { createEvent } from '../util/Event';
import { getStatsfmUserFromDiscordUser } from '../util/getStatsfmUserFromDiscordUser';
import { transformInteraction } from '../util/InteractionOptions';
import type { Logger } from '../util/Logger';
import { reportError } from '../util/Sentry';
import { kCommands, kLogger } from '../util/tokens';
import { CooldownManager } from '../util/CooldownManager';
import { getDuration } from '../util/getDuration';
import { Util } from '../util/Util';
const commands =
  container.resolve<Map<string, BuildedCommand<any, any>>>(kCommands);
const logger = container.resolve<Logger>(kLogger);
const cooldownManager = container.resolve(CooldownManager);

function respond(
  interaction: CommandInteraction,
  data: InteractionReplyOptions
): Promise<Message<boolean>> {
  if (interaction.deferred) {
    return interaction.editReply(data);
  }
  return interaction.reply({ ...data, fetchReply: true });
}

export default createEvent('interactionCreate')
  .setOn(async (interaction) => {
    if (
      !interaction.isCommand() &&
      !interaction.isUserContextMenuCommand() &&
      !interaction.isMessageContextMenuCommand() &&
      !interaction.isAutocomplete() &&
      !interaction.isMessageComponent()
    )
      return;

    // We don't handle DM interactions.
    if (interaction.isMessageComponent()) return;

    const timeStart = Date.now();
    let timeExecute = 0;

    const command = commands.get(interaction.commandName.toLowerCase());
    const statsfmUser = await getStatsfmUserFromDiscordUser(interaction.user);

    if (command && command.enabled) {
      try {
        // TODO: Store command stats
        // Check if command is guild locked
        if (
          command.guilds &&
          command.guilds.length > 0 &&
          interaction.guildId
        ) {
          if (!command.guilds.includes(interaction.guildId)) {
            if (!interaction.isAutocomplete())
              await respond(interaction, {
                content: 'This command is not available in this guild!',
                flags: MessageFlags.Ephemeral,
              });
            return;
          }
        }
        switch (interaction.commandType) {
          case ApplicationCommandType.ChatInput:
            const isAutocomplete = interaction.isAutocomplete();

            logger.info(
              `Executing ${
                isAutocomplete ? 'autocomplete' : 'chat input'
              } command ${interaction.commandName} by ${Util.getDiscordUserTag(
                interaction.user
              )} (${interaction.user.id}) in ${interaction.guild?.name ?? 'DM'} (${
                interaction.guildId ?? interaction.channelId
              }), took ${Date.now() - timeStart}ms`
            );

            if (isAutocomplete) {
              if (command.functions.autocomplete) {
                timeExecute = Date.now();
                await command.functions.autocomplete({
                  interaction,
                  args: transformInteraction(interaction.options.data),
                  statsfmUser,
                  respond,
                });
              }
              break;
            }
            if (command.functions.chatInput) {
              // Check for cooldown
              if (command.managedCooldown || command.ownCooldown) {
                const cooldown = cooldownManager.get(
                  interaction.commandName,
                  interaction.guildId ?? interaction.channelId,
                  interaction.user.id
                );
                if (cooldown) {
                  await respond(interaction, {
                    content: `Please wait ${getDuration(
                      cooldown
                    )} before using this command again.`,
                    flags: MessageFlags.Ephemeral,
                  });
                  return;
                }
              }
              if (command.managedCooldown)
                cooldownManager.set(
                  interaction.commandName,
                  interaction.guildId ?? interaction.channelId,
                  interaction.user.id,
                  command.managedCooldown
                );
              timeExecute = Date.now();
              await command.functions.chatInput({
                interaction,
                args: transformInteraction(interaction.options.data),
                statsfmUser,
                respond,
                subCommands: command.subCommands,
              });
            }
            break;

          case ApplicationCommandType.Message:
            logger.info(
              `Executing message context command ${
                interaction.commandName
              } by ${Util.getDiscordUserTag(interaction.user)} (${
                interaction.user.id
              }) in ${interaction.guild?.name ?? 'DM'} (${interaction.guildId ?? interaction.channelId}), took ${
                Date.now() - timeStart
              }ms`
            );

            if (command.functions.messageContext) {
              timeExecute = Date.now();
              await command.functions.messageContext({
                interaction,
                args: transformInteraction(interaction.options.data),
                statsfmUser,
                respond,
              });
            }
            break;

          case ApplicationCommandType.User:
            logger.info(
              `Executing user context command ${
                interaction.commandName
              } by ${Util.getDiscordUserTag(interaction.user)} (${
                interaction.user.id
              }) in ${interaction.guild?.name ?? 'DM'} (${interaction.guildId ?? interaction.channelId}), took ${
                Date.now() - timeStart
              }ms`
            );

            if (command.functions.userContext) {
              timeExecute = Date.now();
              await command.functions.userContext({
                interaction,
                args: transformInteraction(interaction.options.data),
                statsfmUser,
                respond,
              });
            }
            break;
        }

        const executedType = interaction.isAutocomplete()
          ? 'autocomplete'
          : interaction.commandType === ApplicationCommandType.Message
            ? 'message context'
            : interaction.commandType === ApplicationCommandType.User
              ? 'user context'
              : 'chat input';

        logger.info(
          `Executed ${executedType} command ${
            interaction.commandName
          } by ${Util.getDiscordUserTag(interaction.user)} (${
            interaction.user.id
          }) in ${interaction.guild?.name ?? 'DM'} (${interaction.guildId ?? interaction.channelId}), took ${
            Date.now() - timeStart
          }ms (${Date.now() - timeExecute}ms to execute)`
        );
      } catch (e) {
        const executedType = interaction.isAutocomplete()
          ? 'autocomplete'
          : interaction.commandType === ApplicationCommandType.Message
            ? 'message context'
            : interaction.commandType === ApplicationCommandType.User
              ? 'user context'
              : 'chat input';
        logger.error(
          `Error while executing ${executedType} command ${
            interaction.commandName
          } by ${Util.getDiscordUserTag(interaction.user)} (${
            interaction.user.id
          }) in ${interaction.guild?.name ?? 'DM'} (${interaction.guildId ?? interaction.channelId}), took ${
            Date.now() - timeStart
          }ms (${Date.now() - timeExecute}ms to execute)`
        );
        reportError(e, interaction);
      }
    } else {
      if (!interaction.isAutocomplete())
        await respond(interaction, {
          content: 'This command is not available!',
          flags: MessageFlags.Ephemeral,
        });
      else
        logger.warn(`Unknown autocomplete command ${interaction.commandName}`);
    }
  })
  .build();
