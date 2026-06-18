// Tests for useChatMessages hook
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'collection-ref'),
  doc: vi.fn(() => 'doc-ref'),
  setDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  onSnapshot: vi.fn((q, cb) => { cb({ forEach: (fn) => {} }); return vi.fn(); }),
  query: vi.fn((ref) => ref),
  addDoc: vi.fn(() => Promise.resolve({ id: 'new-id' })),
  getDocs: vi.fn(() => Promise.resolve({ forEach: vi.fn(), docs: [], empty: true })),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => null })),
  updateDoc: vi.fn(() => Promise.resolve())
}));

vi.mock('../../config/firebase', () => ({ db: {}, appId: 'test-app-id' }));
vi.mock('../../utils/ai', () => ({ chatWithPortfolioAI: vi.fn(() => Promise.resolve('AI reply')) }));
vi.mock('../../services/fileParser', () => ({ extractDataFromImage: vi.fn(() => Promise.resolve('extracted text')) }));
vi.mock('../../components/Chat/actionHandlers', () => ({ handleScoreRecord: vi.fn(() => Promise.resolve()) }));
vi.mock('../../utils/debugLog', () => ({ debugLog: vi.fn() }));

describe('useChatMessages', () => {
  const mockProps = {
    user: null, settings: {}, portfolioStats: {}, marketData: [],
    todos: [], memos: [], activeConvId: 'default',
    persistConversation: vi.fn(() => Promise.resolve()),
    setConvLoading: vi.fn(),
    conversations: {},
    useWebSearch: true, enableMacroRadar: false, ocrEngine: 'gemini'
  };

  beforeEach(() => { vi.clearAllMocks(); });

  it('should initialize with welcome message', async () => {
    const { useChatMessages } = await import('../../hooks/useChatMessages');
    const { result } = renderHook(() => useChatMessages(
      mockProps.user, mockProps.settings, mockProps.portfolioStats, mockProps.marketData,
      mockProps.todos, mockProps.memos, mockProps.activeConvId,
      mockProps.persistConversation, mockProps.setConvLoading, mockProps.conversations,
      mockProps.useWebSearch, mockProps.enableMacroRadar, mockProps.ocrEngine
    ));
    expect(result.current.messages.length).toBe(1);
    expect(result.current.messages[0].role).toBe('assistant');
  });

  it('should provide message management functions', async () => {
    const { useChatMessages } = await import('../../hooks/useChatMessages');
    const { result } = renderHook(() => useChatMessages(
      mockProps.user, mockProps.settings, mockProps.portfolioStats, mockProps.marketData,
      mockProps.todos, mockProps.memos, mockProps.activeConvId,
      mockProps.persistConversation, mockProps.setConvLoading, mockProps.conversations,
      mockProps.useWebSearch, mockProps.enableMacroRadar, mockProps.ocrEngine
    ));
    expect(result.current.handleSend).toBeInstanceOf(Function);
    expect(result.current.handleClear).toBeInstanceOf(Function);
    expect(result.current.handleConfirmAction).toBeInstanceOf(Function);
    expect(result.current.handleCancelAction).toBeInstanceOf(Function);
  });

  it('should handle clear messages', async () => {
    const { useChatMessages } = await import('../../hooks/useChatMessages');
    const { result } = renderHook(() => useChatMessages(
      mockProps.user, mockProps.settings, mockProps.portfolioStats, mockProps.marketData,
      mockProps.todos, mockProps.memos, mockProps.activeConvId,
      mockProps.persistConversation, mockProps.setConvLoading, mockProps.conversations,
      mockProps.useWebSearch, mockProps.enableMacroRadar, mockProps.ocrEngine
    ));
    act(() => { result.current.handleClear(); });
    expect(result.current.messages.length).toBe(1);
    expect(result.current.messages[0].role).toBe('assistant');
  });

  it('should handle confirm action', async () => {
    const { useChatMessages } = await import('../../hooks/useChatMessages');
    const { result } = renderHook(() => useChatMessages(
      mockProps.user, mockProps.settings, mockProps.portfolioStats, mockProps.marketData,
      mockProps.todos, mockProps.memos, mockProps.activeConvId,
      mockProps.persistConversation, mockProps.setConvLoading, mockProps.conversations,
      mockProps.useWebSearch, mockProps.enableMacroRadar, mockProps.ocrEngine
    ));
    act(() => { result.current.handleConfirmAction('card1', 'completed'); });
    expect(result.current.messages[0].actions).toBeUndefined();
  });

  it('should handle cancel action', async () => {
    const { useChatMessages } = await import('../../hooks/useChatMessages');
    const { result } = renderHook(() => useChatMessages(
      mockProps.user, mockProps.settings, mockProps.portfolioStats, mockProps.marketData,
      mockProps.todos, mockProps.memos, mockProps.activeConvId,
      mockProps.persistConversation, mockProps.setConvLoading, mockProps.conversations,
      mockProps.useWebSearch, mockProps.enableMacroRadar, mockProps.ocrEngine
    ));
    act(() => { result.current.handleCancelAction('card1'); });
    expect(result.current.messages[0].actions).toBeUndefined();
  });
});
