import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { appDependencies } from "./app-dependencies";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App deps={appDependencies} />
  </StrictMode>
);
