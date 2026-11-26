// How long an agent is kept after its person last used it. The session cookie lasts as long, so nobody can come back
// to an agent that's already gone. Its own module so pages can quote it without pulling in the server.
export const RETENTION_DAYS = 30;
