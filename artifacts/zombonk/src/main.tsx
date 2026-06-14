import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import App from "./App";
import { getStoredToken } from "@/lib/player-store";
import "./index.css";

// Attach the stored session token as a bearer header on every API request so
// money- and identity-affecting actions can verify the caller's identity.
setAuthTokenGetter(() => getStoredToken());

createRoot(document.getElementById("root")!).render(<App />);
