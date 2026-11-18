/** The REST API version this app is written against. See docs.github.com/rest/overview/api-versions. */
export const GITHUB_API_VERSION = '2026-03-10';
export const GITHUB_API_URL = 'https://api.github.com';

/** A failed GitHub request. The message never contains the token. */
export class GitHubError extends Error {
  override readonly name = 'GitHubError';
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface GitHubResponse<T> {
  data: T;
  /** The `Link` header's `rel="next"` URL, when there is another page. */
  next: string | null;
}

export interface GitHubClient {
  request<T>(method: string, pathOrUrl: string, options?: { body?: unknown; signal?: AbortSignal }): Promise<GitHubResponse<T>>;
}

export interface GitHubClientOptions {
  /** A fine-grained token limited to the configured repos (R6.5). Optional for public reads. */
  token?: string | null;
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}

const NEXT_LINK = /<([^>]+)>;\s*rel="next"/;

/** A minimal GitHub REST client: JSON in and out, versioned, paginated through `Link`. */
export function createGitHub(options: GitHubClientOptions = {}): GitHubClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? GITHUB_API_URL;
  return {
    async request<T>(method: string, pathOrUrl: string, { body, signal }: { body?: unknown; signal?: AbortSignal } = {}) {
      const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
      if (new URL(url).origin !== new URL(baseUrl).origin) throw new GitHubError(0, `Refusing to send the token to ${new URL(url).origin}`);
      const headers: Record<string, string> = {
        accept: 'application/vnd.github+json',
        'x-github-api-version': GITHUB_API_VERSION,
      };
      if (options.token) headers.authorization = `Bearer ${options.token}`;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = JSON.stringify(body);
      if (signal) init.signal = signal;

      const res = await fetchImpl(url, init);
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        const detail = typeof data === 'object' && data && 'message' in data ? String((data as { message: unknown }).message) : res.statusText;
        throw new GitHubError(res.status, `GitHub returned ${res.status} for ${method} ${new URL(url).pathname}: ${detail}`);
      }
      return { data: data as T, next: NEXT_LINK.exec(res.headers.get('link') ?? '')?.[1] ?? null };
    },
  };
}

/** `owner/repo`, as GitHub allows them. */
export const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
