try {
  delete Object.getPrototypeOf(navigator).webdriver;
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
  });
} catch (e) {}
//