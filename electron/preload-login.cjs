try {
  delete Object.getPrototypeOf(navigator).webdriver;
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
  });
  if (!window.chrome) {
    window.chrome = {
      app: { isInstalled: false },
      runtime: {}
    };
  }
} catch (e) {}
