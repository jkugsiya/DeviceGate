// Claude Code's unauthenticated connectivity check (HEAD /api/hello).
export function HEAD() {
  return new Response(null, { status: 200 });
}

export function GET() {
  return new Response("ok");
}
