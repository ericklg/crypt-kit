import type { Presenter } from '@crypt-kit/board';
import type { StaleItem } from './detectors/stale-items';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How a stale item reads on its stone and in the drawer. Runs on the server. */
export const staleItemPresenter: Presenter<StaleItem> = {
  meta: (f) => `${f.payload.repo} · ${f.payload.kind === 'pull_request' ? 'pull request' : 'issue'} #${f.payload.number}`,
  age: (f, now) => {
    const days = Math.max(0, Math.floor((now.getTime() - Date.parse(f.payload.updatedAt)) / DAY_MS));
    return `${days} ${days === 1 ? 'day' : 'days'} quiet`;
  },
  facts: (f) => {
    const p = f.payload;
    const lastReply = p.lastComments.at(-1)?.author;
    return [
      { label: 'Comments', value: String(p.comments) },
      ...(lastReply ? [{ label: 'Last reply', value: `@${lastReply}` }] : []),
      ...(p.labels.length ? [{ label: 'Labels', value: p.labels.join(', ') }] : []),
    ];
  },
};
