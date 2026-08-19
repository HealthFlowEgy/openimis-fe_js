// import "react-app-polyfill/ie11";
// import "react-app-polyfill/stable";
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import rtlPlugin from "stylis-plugin-rtl";
import { ThemeProvider } from "@mui/material/styles";
import { LinearProgress } from "@mui/material";
import { Provider } from "react-redux";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { IntlProvider } from "react-intl";
import * as serviceWorker from "./serviceWorker";
import createAppTheme from "./helpers/theme";
import store from "./helpers/store";
import LocalesManager from "./LocalesManager";
import ModulesManager from "./ModulesManager";
import ModulesManagerProvider from "./ModulesManagerProvider";
import {
  App,
  FatalError,
  baseApiUrl,
  apiHeaders,
  isSessionError,
  isUnauthenticatedRoute,
  clearExpiredSession,
  redirectToLogin,
  handleBootLogout,
} from "@openimis/fe-core";
import getConfiguredLogo from "./helpers/logo";
import messages_ref from "./translations/ref.json";
import "./index.css";
import "./rc-cascader.css";

const loadConfiguration = async () => {
  const response = await fetch(`${baseApiUrl}/graphql`, {
    method: "post",
    credentials: "omit",
    headers: apiHeaders(),
    body: JSON.stringify({
      query: `{ moduleConfigurations { module, config, controls { field, usage } } }`,
    }),
  });

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (isSessionError(response.status)) {
      await clearExpiredSession();
      if (!isUnauthenticatedRoute()) {
        await redirectToLogin();
        return new Promise(() => {});
      }
    }
    if (!response.ok) {
      throw response;
    }
    throw error;
  }

  const { data, errors = [] } = payload;

  if (isSessionError(response.status, errors)) {
    await clearExpiredSession();
    if (!isUnauthenticatedRoute()) {
      await redirectToLogin();
      return new Promise(() => {});
    }
  }

  if (!response.ok) {
    throw response;
  }

  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }

  if (!data?.moduleConfigurations) {
    throw new Error("Failed to load module configurations");
  }

  const out = data.moduleConfigurations.reduce((acc, c) => {
    try {
      acc[c.module] = { controls: c.controls, ...JSON.parse(c.config) };
    } catch (error) {
      console.error(`Failed to parse module ${c.module} config`, error);
    }
    return acc;
  }, {});
  return out;
};

const bootLogoutPending = handleBootLogout();

const ltrCache = createCache({ key: "mui" });
const rtlCache = createCache({ key: "muirtl", stylisPlugins: [rtlPlugin] });

const AppContainer = () => {
  const [appState, setAppState] = React.useState({
    isLoading: true,
    config: undefined,
    error: null,
    modulesManager: null,
  });

  const localesManager = new LocalesManager();

  useEffect(() => {
    const initialize = async () => {
      try {
        const config = await loadConfiguration();
        const modulesManager = await ModulesManager.init(config);
        console.log("[openIMIS] ModulesManager initialized:", modulesManager);
        setAppState({
          config,
          error: null,
          isLoading: false,
          modulesManager,
        });
      } catch (error) {
        console.error("[openIMIS] Error during initialization:", error);
        setAppState({
          error,
          isLoading: false,
        });
      }
    };
    initialize();
  }, []);

  const themeConfig = appState?.config?.["fe-core"]?.theme || {};
  const appDirection = themeConfig.direction === "rtl" ? "rtl" : "ltr";
  const dynamicTheme = createAppTheme({ ...themeConfig, direction: appDirection });
  const emotionCache = appDirection === "rtl" ? rtlCache : ltrCache;
  const logo = getConfiguredLogo(appState.config);

  useEffect(() => {
    document.documentElement.dir = appDirection;
    document.documentElement.lang = themeConfig.locale || (appDirection === "rtl" ? "ar" : "en");
  }, [appDirection, themeConfig.locale]);

  const themed = (children) => (
    <CacheProvider value={emotionCache}>
      <ThemeProvider theme={dynamicTheme}>{children}</ThemeProvider>
    </CacheProvider>
  );
  const disableTextLogo = appState?.config?.["fe-core"]?.logo?.disableTextLogo || false;

  if (bootLogoutPending || appState.isLoading) {
    console.log("[openIMIS] App is loading...");
    return themed(<LinearProgress className="bootstrap" />);
  }

  if (appState.error) {
    console.error("[openIMIS] Fatal error state:", appState.error);
    return themed(
      <IntlProvider locale={themeConfig.locale || "en"} messages={messages_ref}>
        <FatalError
          error={{
            code: appState.error.status,
            message: appState.error.statusText,
          }}
        />
      </IntlProvider>,
    );
  }

  const { modulesManager } = appState;
  console.log("[openIMIS] Rendering app with modulesManager:", modulesManager);

  if (!modulesManager) {
    console.log("[openIMIS] modulesManager not available, cannot render app");
    return themed(<LinearProgress className="bootstrap" />);
  }

  const reducers = modulesManager.getContribs("reducers").reduce((acc, r) => {
    acc[r.key] = r.reducer;
    return acc;
  }, {});
  const middlewares = modulesManager.getContribs("middlewares");

  return (
    <CacheProvider value={emotionCache}>
      <ThemeProvider theme={dynamicTheme}>
        <Provider store={store(reducers, middlewares)}>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <ModulesManagerProvider modulesManager={modulesManager}>
              <App
                basename={process.env.PUBLIC_URL}
                localesManager={localesManager}
                messages={messages_ref}
                logo={logo}
                applicationName={themeConfig.applicationName || "HealthFlow Payer"}
                disableTextLogo={disableTextLogo}
              />
            </ModulesManagerProvider>
          </LocalizationProvider>
        </Provider>
      </ThemeProvider>
    </CacheProvider>
  );
};

const root = createRoot(document.getElementById("root"));
root.render(<AppContainer />);
serviceWorker.unregister();
