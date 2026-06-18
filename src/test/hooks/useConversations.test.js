// Tests for useConversations hook
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('firebase/firestore', () => {
  const mockUnsub = vi.fn();
  return {
    collection: vi.fn(() => 'collection-ref'),
    doc: vi.fn(() => 'doc-ref'),
    setDoc: vi.fn(() => Promise.resolve()),
    deleteDoc: vi.fn(() => Promise.resolve()),
    onSnapshot: vi.fn((q, cb) => { cb({ forEach: (fn) => {} }); return mockUnsub; }),
    query: vi.fn((ref) => ref),
    addDoc: vi.fn(() => Promise.resolve({ id: 'new-id' })),
    getDocs: vi.fn(() => Promise.resolve({ forEach: vi.fn(), docs: [], empty: true })),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => null })),
    updateDoc: vi.fn(() => Promise.resolve())
  };
});

vi.mock('../../config/firebase', () => ({
  db: {},
  appId: 'test-app-id'
}));

describe('useConversations', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should initialize with default conversation state', async () => {
    const { useConversations } = await import('../../hooks/useConversations');
    const { result } = renderHook(() => useConversations(null, {}));
    expect(result.current.activeConvId).toBe('default');
    expect(result.current.editingConvId).toBeNull();
  });

  it('should provide conversation management functions', async () => {
    const { useConversations } = await import('../../hooks/useConversations');
    const { result } = renderHook(() => useConversations(null, {}));
    expect(result.current.handleStartEditTitle).toBeInstanceOf(Function);
    expect(result.current.handleNewConversation).toBeInstanceOf(Function);
    expect(result.current.handleSwitchConversation).toBeInstanceOf(Function);
    expect(result.current.handleDeleteConversation).toBeInstanceOf(Function);
  });

  it('should handle start edit title', async () => {
    const { useConversations } = await import('../../hooks/useConversations');
    const { result } = renderHook(() => useConversations(null, {}));
    act(() => { result.current.handleStartEditTitle('conv1', 'My Conversation'); });
    expect(result.current.editingConvId).toBe('conv1');
    expect(result.current.editTitleValue).toBe('My Conversation');
  });

  it('should handle switch conversation', async () => {
    const { useConversations } = await import('../../hooks/useConversations');
    const { result } = renderHook(() => useConversations(null, {}));
    act(() => { result.current.handleSwitchConversation('conv2'); });
    expect(result.current.activeConvId).toBe('conv2');
  });
});
