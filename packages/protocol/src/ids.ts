const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function alnum(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = "";
  for (let i = 0; i < n; i++) s += ALNUM[bytes[i]! % ALNUM.length];
  return s;
}

function encodeTime(now: number): string {
  let str = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    str = CROCKFORD[t % 32] + str;
    t = Math.floor(t / 32);
  }
  return str;
}

function encodeRandom(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let acc = 0n;
  for (const b of bytes) acc = (acc << 8n) | BigInt(b);
  let str = "";
  for (let i = 0; i < 16; i++) {
    str = CROCKFORD[Number(acc & 31n)] + str;
    acc >>= 5n;
  }
  return str;
}

export function ulid(now = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

export const ids = {
  job: (): string => `job_${ulid()}`,
  thread: (): string => `thr_${ulid()}`,
  msg: (): string => `msg_01${alnum(24)}`,
  toolu: (): string => `toolu_01${alnum(24)}`,
  req: (): string => `req_01${alnum(24)}`,
  chatcmpl: (): string => `chatcmpl-${alnum(24)}`,
  call: (): string => `call_${alnum(24)}`,
  resp: (): string => `resp_${alnum(24)}`,
  fc: (): string => `fc_${alnum(24)}`,
  apc: (): string => `apc_${alnum(24)}`,
  lsc: (): string => `lsc_${alnum(24)}`,
  shc: (): string => `shc_${alnum(24)}`,
  ctc: (): string => `ctc_${alnum(24)}`,
  rs: (): string => `rs_${alnum(24)}`,
};

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
