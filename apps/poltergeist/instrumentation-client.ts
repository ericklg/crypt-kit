import { initBotId } from 'botid/client/core';

// The board's server actions POST to the page they run on ("/"). checkBotId() in
// app/actions.ts fails for any request BotID wasn't told to protect here.
initBotId({
  protect: [{ path: '/', method: 'POST' }],
});
