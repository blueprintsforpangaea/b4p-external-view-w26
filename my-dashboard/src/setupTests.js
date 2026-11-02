// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// App tests cover today's guest checkout; the sign-in preview has its own tests.
process.env.REACT_APP_AUTH_PREVIEW = 'off';

// Tests never reach a real backend (one with the request sheet set up would add rows): a test that
// needs the network mocks fetch itself (jest.spyOn(global, 'fetch') or global.fetch = jest.fn()).
global.fetch = (url) => Promise.reject(new Error(`tests must not make real requests: ${url}`));
