import { ModelConfigError } from '@crypt-kit/agent';
import { Board } from '@crypt-kit/board';
import { loadBoard } from '@crypt-kit/board/server';
import { connection } from 'next/server';
import { ConfigError } from '../config';
import { getConfig, getRunner, getSource, getWatchlist } from '../crypt';
import { priceDropPresenter } from '../presenter';
import { poltergeistTheme } from '../theme';
import { approve, redraft, run, settle, spare } from './actions';
import { WatchlistDrawer } from './watchlist-drawer';

const WEEKLY_GOAL = 6;
const actions = { approve, spare, redraft, settle, run };

export default async function Page() {
  // The board is live data: render it per request, never at build time.
  await connection();

  let runner;
  try {
    getConfig(); // validates the env first, so its errors get the notice
    runner = getRunner();
  } catch (error) {
    // Only setup mistakes get the notice; anything else is a real error.
    if (error instanceof ConfigError || error instanceof ModelConfigError) return <SetupNotice message={error.message} />;
    throw error;
  }

  const now = new Date();
  const source = getSource();
  const [{ haunts, score }, watched] = await Promise.all([
    loadBoard(runner, priceDropPresenter, { now }),
    getWatchlist().list(source.id),
  ]);
  return (
    <Board
      theme={poltergeistTheme(watched.length, source.name)}
      haunts={haunts}
      score={score}
      weeklyGoal={WEEKLY_GOAL}
      actions={actions}
      now={now.toISOString()}
      headerActions={<WatchlistDrawer sourceName={source.name === 'demo prices' ? 'demo data' : source.name} />}
    />
  );
}

/** Shown instead of the board when env vars are missing. Names variables, never values. */
function SetupNotice({ message }: { message: string }) {
  return (
    <main className="setup">
      <h1>Price Poltergeist needs setting up</h1>
      <p>{message}</p>
      <p>
        See <code>apps/poltergeist/README.md</code> for the variables to set.
      </p>
    </main>
  );
}
