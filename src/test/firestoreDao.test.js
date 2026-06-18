// Tests for firestoreDao.js - Data Access Layer
import { describe, it, expect, vi } from 'vitest';

// Mock Firebase modules
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'collection-ref'),
  doc: vi.fn(() => 'doc-ref'),
  setDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  onSnapshot: vi.fn((q, cb) => {
    cb({
      forEach: (fn) => {
        // simulate no docs
      }
    });
    return vi.fn(); // unsubscribe
  }),
  query: vi.fn((ref) => ref),
  addDoc: vi.fn(() => Promise.resolve({ id: 'new-id' })),
  getDocs: vi.fn(() => Promise.resolve({
    forEach: vi.fn(),
    docs: [],
    empty: true
  })),
  getDoc: vi.fn(() => Promise.resolve({
    exists: () => false,
    data: () => null
  })),
  updateDoc: vi.fn(() => Promise.resolve()),
  orderBy: vi.fn(() => 'order-by'),
  limit: vi.fn(() => 'limit'),
  where: vi.fn(() => 'where')
}));

vi.mock('../config/firebase', () => ({
  db: {},
  appId: 'test-app-id'
}));

describe('firestoreDao', () => {
  describe('buildPath', () => {
    it('should build correct path without docId', async () => {
      const { buildPath } = await import('../services/firestoreDao');
      const path = buildPath('user1', 'funds');
      expect(path).toEqual(['artifacts', 'test-app-id', 'users', 'user1', 'funds']);
    });

    it('should build correct path with docId', async () => {
      const { buildPath } = await import('../services/firestoreDao');
      const path = buildPath('user1', 'funds', 'fund123');
      expect(path).toEqual(['artifacts', 'test-app-id', 'users', 'user1', 'funds', 'fund123']);
    });
  });

  describe('fundsDao', () => {
    it('should have correct CRUD methods', async () => {
      const { fundsDao } = await import('../services/firestoreDao');
      expect(fundsDao).toHaveProperty('getAll');
      expect(fundsDao).toHaveProperty('save');
      expect(fundsDao).toHaveProperty('delete');
      expect(fundsDao.getAll).toBeInstanceOf(Function);
      expect(fundsDao.save).toBeInstanceOf(Function);
      expect(fundsDao.delete).toBeInstanceOf(Function);
    });

    it('getAll should register onSnapshot listener', async () => {
      const { fundsDao } = await import('../services/firestoreDao');
      const cb = vi.fn();
      const unsub = fundsDao.getAll('user1', cb);
      expect(unsub).toBeInstanceOf(Function);
    });
  });

  describe('todosDao', () => {
    it('should have correct CRUD methods', async () => {
      const { todosDao } = await import('../services/firestoreDao');
      expect(todosDao).toHaveProperty('getAll');
      expect(todosDao).toHaveProperty('add');
      expect(todosDao).toHaveProperty('update');
      expect(todosDao).toHaveProperty('delete');
    });
  });

  describe('settingsDao', () => {
    it('should have get and set methods', async () => {
      const { settingsDao } = await import('../services/firestoreDao');
      expect(settingsDao).toHaveProperty('get');
      expect(settingsDao).toHaveProperty('set');
    });
  });

  describe('memosDao', () => {
    it('should have correct methods', async () => {
      const { memosDao } = await import('../services/firestoreDao');
      expect(memosDao).toHaveProperty('getAll');
      expect(memosDao).toHaveProperty('save');
      expect(memosDao).toHaveProperty('delete');
    });
  });

  describe('conversationsDao', () => {
    it('should have correct methods', async () => {
      const { conversationsDao } = await import('../services/firestoreDao');
      expect(conversationsDao).toHaveProperty('getAll');
      expect(conversationsDao).toHaveProperty('save');
      expect(conversationsDao).toHaveProperty('delete');
      expect(conversationsDao).toHaveProperty('updateTitle');
    });
  });

  describe('scoringDao', () => {
    it('should have correct methods', async () => {
      const { scoringDao } = await import('../services/firestoreDao');
      expect(scoringDao).toHaveProperty('getAll');
      expect(scoringDao).toHaveProperty('save');
      expect(scoringDao).toHaveProperty('delete');
    });
  });
});

