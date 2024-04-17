import { container } from 'tsyringe';
import { kLogger } from '../util/tokens';
import { createEvent } from '../util/Event';
import type { Logger } from '../util/Logger';

const logger = container.resolve<Logger>(kLogger);

export default createEvent('ready')
  .setOn(async () => {
    logger.info('Online!');
  })
  .build();
