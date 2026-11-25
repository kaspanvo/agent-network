import { claudeModel } from "./claude";
import { SESSIONS_DIR } from "./paths";
import { createIntakeServer } from "./server";
import { SessionStore } from "./store";

const port = Number(process.env.PORT ?? 4319);
const server = createIntakeServer({ model: claudeModel(), store: new SessionStore(SESSIONS_DIR) });

server.listen(port, "127.0.0.1", () => {
  console.log(`Open intake running at http://127.0.0.1:${port}`);
  console.log(`Interviews are saved to ${SESSIONS_DIR} (gitignored).`);
});
