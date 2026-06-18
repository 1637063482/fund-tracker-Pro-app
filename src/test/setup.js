// Test setup
import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock Firebase
vi.mock('../config/firebase', () => ({
  db: {},
  appId: 'test-app-id',
  auth: {}
}));
