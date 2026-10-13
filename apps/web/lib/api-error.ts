/** Error codes the API sends in `detail.code` (anything else is passed through as a plain string). */
export type ApiErrorCode = "auth_required" | "invalid_google_token" | "daily_limit" | "burst_limit" | (string & {});

/** A failed API call: HTTP status plus the structured `detail` body when the server sent one. Never carries tokens. */
export class ApiError extends Error {
  status: number;
  code: ApiErrorCode | null;
  kind: "chat" | "run" | "light" | null;
  retryAfterS: number | null;
  resetAt: string | null;
  used: number | null;
  limit: number | null;

  constructor(status: number, d: { code?: string; kind?: string; message?: string; retry_after_s?: number; reset_at?: string; used?: number; limit?: number } = {}, retryHeader?: string | null) {
    super(d.message || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = d.code ?? null;
    this.kind = d.kind === "chat" || d.kind === "run" || d.kind === "light" ? d.kind : null;
    const header = retryHeader != null && retryHeader !== "" && Number.isFinite(Number(retryHeader)) ? Number(retryHeader) : null;
    this.retryAfterS = typeof d.retry_after_s === "number" ? d.retry_after_s : header;
    this.resetAt = d.reset_at ?? null;
    this.used = typeof d.used === "number" ? d.used : null;
    this.limit = typeof d.limit === "number" ? d.limit : null;
  }

  get isAuthRequired() { return this.status === 401; }
  get isBurst() { return this.status === 429 && this.code === "burst_limit"; }
  get isDaily() { return this.status === 429 && this.code !== "burst_limit"; }
}

/** Build an ApiError from a non-OK response (FastAPI style `{detail: {...}}`, or `{detail: "text"}`, or no JSON at all). */
export async function readApiError(res: Response): Promise<ApiError> {
  let detail: ConstructorParameters<typeof ApiError>[1] = {};
  try {
    const body = await res.json();
    const d = body?.detail;
    if (d && typeof d === "object" && !Array.isArray(d)) detail = d;
    else if (typeof d === "string") detail = { message: d };
  } catch { /* not JSON */ }
  return new ApiError(res.status, detail, res.headers.get("Retry-After"));
}
