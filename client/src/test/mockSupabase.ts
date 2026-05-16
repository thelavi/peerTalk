import { vi, type Mock } from "vitest";

type QueryResult = { data: unknown; error: unknown };
type ChainAction = (resolved: QueryResult) => void;

export type ChannelHandlers = {
  presence: Array<(payload: unknown) => void>;
  broadcast: Array<(payload: { payload: unknown }) => void>;
  postgresChanges: Array<(payload: { new: unknown }) => void>;
};

export type FakeChannel = {
  topic: string;
  state: "joined" | "closed";
  handlers: ChannelHandlers;
  sent: Array<{ event: string; payload: unknown }>;
  on: Mock;
  send: Mock;
  subscribe: Mock;
  unsubscribe: Mock;
  presenceState: Mock;
  track: Mock;
  // helpers for tests
  firePresenceSync: (state: Record<string, unknown>) => void;
  fireBroadcast: (event: string, payload: unknown) => void;
  firePostgresInsert: (row: unknown) => void;
};

function makeChannel(topic: string): FakeChannel {
  let presenceStateValue: Record<string, unknown> = {};
  const handlers: ChannelHandlers = {
    presence: [],
    broadcast: [],
    postgresChanges: [],
  };
  const sent: Array<{ event: string; payload: unknown }> = [];

  const channel: FakeChannel = {
    topic: `realtime:${topic}`,
    state: "joined",
    handlers,
    sent,
    on: vi.fn((eventType: string, filter: unknown, cb: unknown) => {
      if (eventType === "presence") {
        handlers.presence.push(cb as (p: unknown) => void);
      } else if (eventType === "broadcast") {
        handlers.broadcast.push(cb as (p: { payload: unknown }) => void);
      } else if (eventType === "postgres_changes") {
        handlers.postgresChanges.push(cb as (p: { new: unknown }) => void);
      }
      // filter parameter unused in stubs
      void filter;
      return channel;
    }),
    send: vi.fn(({ event, payload }: { event: string; payload: unknown }) => {
      sent.push({ event, payload });
      return channel;
    }),
    subscribe: vi.fn((cb?: (status: string) => void) => {
      cb?.("SUBSCRIBED");
      return channel;
    }),
    unsubscribe: vi.fn(() => Promise.resolve("ok")),
    presenceState: vi.fn(() => presenceStateValue),
    track: vi.fn(() => Promise.resolve("ok")),
    firePresenceSync(state) {
      presenceStateValue = state;
      handlers.presence.forEach((h) => h({}));
    },
    fireBroadcast(_event, payload) {
      handlers.broadcast.forEach((h) => h({ payload }));
    },
    firePostgresInsert(row) {
      handlers.postgresChanges.forEach((h) => h({ new: row }));
    },
  };
  return channel;
}

type AuthStateChangeCb = (event: string, session: unknown) => void;
type AuthMockState = {
  session: unknown;
  signUpResult: { data: unknown; error: unknown };
  signInResult: { data: unknown; error: unknown };
  signOutResult: { error: unknown };
  listeners: AuthStateChangeCb[];
};

export type FakeSupabase = {
  auth: {
    getSession: Mock;
    onAuthStateChange: Mock;
    signUp: Mock;
    signInWithPassword: Mock;
    signOut: Mock;
  };
  channel: Mock;
  channels: FakeChannel[];
  getChannels: Mock;
  removeChannel: Mock;
  from: Mock;
  // table-specific responders
  setTableResult: (table: string, op: string, result: QueryResult) => void;
  authState: AuthMockState;
  fireAuthChange: (event: string, session: unknown) => void;
};

export function createFakeSupabase(): FakeSupabase {
  const channels: FakeChannel[] = [];
  const tableResults = new Map<string, QueryResult>();
  const authState: AuthMockState = {
    session: null,
    signUpResult: { data: { user: { id: "uid-new" } }, error: null },
    signInResult: { data: { user: { id: "uid-existing" } }, error: null },
    signOutResult: { error: null },
    listeners: [],
  };

  const setTableResult = (table: string, op: string, result: QueryResult) => {
    tableResults.set(`${table}::${op}`, result);
  };

  function makeQueryBuilder(table: string, op: string) {
    const key = `${table}::${op}`;
    const fallback: QueryResult = { data: [], error: null };
    const resolved = () => tableResults.get(key) ?? fallback;
    const action: ChainAction = () => undefined;
    void action;

    const builder: {
      [k: string]: unknown;
      then: (
        onF: (v: QueryResult) => unknown,
        onR?: (e: unknown) => unknown
      ) => Promise<unknown>;
    } = {
      select: vi.fn(() => builder),
      insert: vi.fn(() => makeQueryBuilder(table, "insert")),
      update: vi.fn(() => makeQueryBuilder(table, "update")),
      upsert: vi.fn(() => makeQueryBuilder(table, "upsert")),
      delete: vi.fn(() => makeQueryBuilder(table, "delete")),
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      single: vi.fn(() => Promise.resolve(resolved())),
      then(onF, onR) {
        return Promise.resolve(resolved()).then(onF, onR);
      },
    };
    return builder;
  }

  const fake: FakeSupabase = {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: authState.session } })),
      onAuthStateChange: vi.fn((cb: AuthStateChangeCb) => {
        authState.listeners.push(cb);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signUp: vi.fn(() => Promise.resolve(authState.signUpResult)),
      signInWithPassword: vi.fn(() => Promise.resolve(authState.signInResult)),
      signOut: vi.fn(() => Promise.resolve(authState.signOutResult)),
    },
    channel: vi.fn((name: string) => {
      const ch = makeChannel(name);
      channels.push(ch);
      return ch;
    }),
    channels,
    getChannels: vi.fn(() => channels),
    removeChannel: vi.fn((ch: FakeChannel) => {
      const idx = channels.indexOf(ch);
      if (idx >= 0) channels.splice(idx, 1);
      ch.state = "closed";
      return Promise.resolve("ok");
    }),
    from: vi.fn((table: string) => makeQueryBuilder(table, "select")),
    setTableResult,
    authState,
    fireAuthChange(event, session) {
      authState.session = session;
      authState.listeners.forEach((l) => l(event, session));
    },
  };
  return fake;
}

export function installFakeSupabase(fake: FakeSupabase) {
  vi.doMock("../lib/supabase", () => ({ supabase: fake }));
}
