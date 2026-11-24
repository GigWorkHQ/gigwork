import { API } from "./config";

// The same GigWork API the web app uses, with the paired device session as the bearer token.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: { path: string; message: string }[]) { super(message); }
}

let expiredHandler: (() => void) | null = null;
/** Called once when the server says the device session is gone (unpaired on the web, or expired). */
export const onSessionExpired = (handler: () => void) => { expiredHandler = handler; };

export function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.fields?.length) return `${error.message} ${error.fields.map((f) => `${f.path || "request"}: ${f.message}`).join("; ")}`;
  return error instanceof Error && error.message ? error.message : "Something went wrong. Try again.";
}

export async function request<T = any>(path: string, options: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const { method = "GET", body, token } = options;
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ApiError(0, "network_error", "GigWork couldn't be reached. Check your connection and try again.");
  }
  if (response.status === 204) return null as T;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error ?? {};
    if (token && response.status === 401) expiredHandler?.();
    throw new ApiError(response.status, error.code || "http_error", error.message || `Request failed (${response.status}).`, error.fields);
  }
  return (payload && "data" in payload ? payload.data : payload) as T;
}

const get = <T = any>(path: string, token?: string | null) => request<T>(path, { token });
const post = <T = any>(path: string, token: string | null, body: unknown = {}) => request<T>(path, { method: "POST", token, body });

export const pairing = {
  redeem: (code: string, deviceName: string) => post("/v1/auth/pair", null, { code, deviceName }),
  unpair: (token: string, sessionId: string) => request(`/v1/devices/${sessionId}`, { method: "DELETE", token }),
};

export const account = {
  me: (t: string) => get("/v1/me", t),
  payouts: (t: string) => get("/v1/payouts", t),
  sent: (t: string) => get("/v1/payments/sent", t),
  history: (t: string) => get("/v1/history", t),
  referrals: (t: string) => get("/v1/referrals", t),
  claimBonus: (t: string, id: string) => post(`/v1/referrals/bonuses/${id}/claim`, t),
  recoverable: (t: string) => get("/v1/recoverable", t),
};

export const jobs = {
  ready: async () => { const r: any = await request("/v1/jobs/ready?page=1&limit=50"); return Array.isArray(r) ? r : r?.items ?? []; },
  mine: (t: string) => get("/v1/jobs/mine", t),
  get: (t: string, id: string) => get(`/v1/jobs/${id}`, t),
  claim: (t: string, id: string) => post(`/v1/jobs/${id}/claim`, t),
  submit: (t: string, id: string, body: { summary: string; deliverable: string; evidence: string[] }) => post(`/v1/jobs/${id}/submissions`, t, body),
  submissions: (t: string, id: string) => get(`/v1/jobs/${id}/submissions`, t),
  revisions: (t: string, id: string) => get(`/v1/jobs/${id}/revisions`, t),
  requestRevision: (t: string, id: string, feedback: string) => post(`/v1/jobs/${id}/revisions`, t, { feedback }),
  accept: (t: string, id: string) => post(`/v1/jobs/${id}/accept`, t),
  dispute: (t: string, id: string, reason: string) => post(`/v1/jobs/${id}/disputes`, t, { reason }),
  cancel: (t: string, id: string) => post(`/v1/jobs/${id}/cancel`, t),
};

export const tasks = {
  list: () => get("/v1/tasks"),
  assignments: (t: string) => get("/v1/tasks/assignments", t),
  claim: (t: string, batchId: string) => post(`/v1/tasks/${batchId}/claim`, t),
  submit: (t: string, id: string, body: { answer: string; choice?: string }) => post(`/v1/tasks/assignments/${id}/submit`, t, body),
  release: (t: string, id: string) => post(`/v1/tasks/assignments/${id}/release`, t),
  dispute: (t: string, id: string, reason: string) => post(`/v1/tasks/assignments/${id}/dispute`, t, { reason }),
};

export const batches = {
  mine: (t: string) => get("/v1/batches/mine", t),
  get: (t: string, id: string) => get(`/v1/batches/${id}`, t),
  close: (t: string, id: string) => post(`/v1/batches/${id}/close`, t),
  submissions: (t: string, id: string) => get(`/v1/batches/${id}/submissions`, t),
  approve: (t: string, id: string, assignmentId: string) => post(`/v1/batches/${id}/assignments/${assignmentId}/approve`, t),
  approveAll: (t: string, id: string) => post(`/v1/batches/${id}/approve-all`, t),
  reject: (t: string, id: string, assignmentId: string, reason: string) => post(`/v1/batches/${id}/assignments/${assignmentId}/reject`, t, { reason }),
};

export const gigs = {
  open: () => get("/v1/gigs/open"),
  mine: (t: string) => get("/v1/gigs/mine", t),
  get: (t: string, id: string) => get(`/v1/gigs/${id}`, t),
  accept: (t: string, id: string) => post(`/v1/gigs/${id}/accept`, t),
  cancel: (t: string, id: string) => post(`/v1/gigs/${id}/cancel`, t),
  milestone: (t: string, id: string, milestoneId: string, action: string, body: unknown = {}) => post(`/v1/gigs/${id}/milestones/${milestoneId}/${action}`, t, body),
};

export const contracts = {
  mine: (t: string) => get("/v1/contracts/mine", t),
  get: (t: string, id: string) => get(`/v1/contracts/${id}`, t),
  accept: (t: string, id: string) => post(`/v1/contracts/${id}/accept`, t),
  decline: (t: string, id: string) => post(`/v1/contracts/${id}/decline`, t),
  respondRate: (t: string, id: string, accept: boolean) => post(`/v1/contracts/${id}/rate/respond`, t, { accept }),
  end: (t: string, id: string) => post(`/v1/contracts/${id}/end`, t),
};

export const reviews = {
  me: (t: string) => get("/v1/reviews/me", t),
  get: (t: string, id: string) => get(`/v1/reviews/${id}`, t),
  resolve: (t: string, id: string, body: { outcome: string; note: string; workerShareBps?: number }) => post(`/v1/reviews/${id}/resolve`, t, body),
};

let configRequest: Promise<any> | null = null;
/** Public chain configuration (explorer, token), fetched once. */
export function chainConfig() {
  configRequest ??= request("/v1/config").catch((e) => { configRequest = null; throw e; });
  return configRequest;
}
