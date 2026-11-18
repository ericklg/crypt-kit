import { ModelConfigError } from '@crypt-kit/agent';
import { Board } from '@crypt-kit/board';
import { loadBoard } from '@crypt-kit/board/server';
import { connection } from 'next/server';
import { ConfigError } from '../config';
import { getConfig, getRunner } from '../crypt';
import { staleItemPresenter } from '../presenter';
import { exorcistTheme } from '../theme';
import { approve, redraft, run, settle, spare } from './actions';

const WEEKLY_GOAL = 20;
const actions = { approve, spare, redraft, settle, run };

export default async function Page() {
  // The board is live data: render it per request, never at build time.
  await connection();

  let config;
  let runner;
  try {
    config = getConfig();
    runner = getRunner();
  } catch (error) {
    // Only setup mistakes get the notice; anything else is a real error.
    if (error instanceof ConfigError || error instanceof ModelConfigError) return <SetupNotice message={error.message} />;
    throw error;
  }

  const now = new Date();
  const { haunts, score } = await loadBoard(runner, staleItemPresenter, { now });
  return (
    <Board
      theme={exorcistTheme(config.repos)}
      haunts={haunts}
      score={score}
      weeklyGoal={WEEKLY_GOAL}
      actions={actions}
      now={now.toISOString()}
    />
  );
}

/** Shown instead of the board when env vars are missing. Names variables, never values. */
function SetupNotice({ message }: { message: string }) {
  return (
    <main className="setup">
      <h1>Exorcist needs setting up</h1>
      <p>{message}</p>
      <p>
        See <code>apps/exorcist/README.md</code> for the variables to set.
      </p>
    </main>
  );
}
