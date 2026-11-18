import { Board } from '@crypt-kit/board';
import { loadBoard } from '@crypt-kit/board/server';
import { connection } from 'next/server';
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
  try {
    config = getConfig();
  } catch (error) {
    return <SetupNotice message={error instanceof Error ? error.message : String(error)} />;
  }

  const now = new Date();
  const { haunts, score } = await loadBoard(getRunner(), staleItemPresenter, { now });
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
