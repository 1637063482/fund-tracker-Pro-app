// Unified Firestore DAO Layer
// Centralizes all Firestore path building and CRUD operations
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, addDoc, updateDoc, getDocs, getDoc } from 'firebase/firestore';
import { db, appId } from '../config/firebase';

// ===== Path Builder =====
function buildPath(userId, subcollection, docId) {
  const base = ['artifacts', appId, 'users', userId, subcollection];
  if (docId) base.push(docId);
  return base;
}

function colRef(userId, subcollection) {
  return collection(db, ...buildPath(userId, subcollection));
}

function docRef(userId, subcollection, docId) {
  return doc(db, ...buildPath(userId, subcollection, docId));
}

// ===== Funds DAO =====
export const fundsDao = {
  getAll(userId, onData) {
    return onSnapshot(query(colRef(userId, 'funds')), (snapshot) => {
      const data = [];
      snapshot.forEach(d => data.push({ id: d.id, ...d.data() }));
      onData(data);
    }, (err) => {
      console.error('fundsDao.getAll error:', err);
    });
  },
  async save(userId, fundId, data) {
    return setDoc(docRef(userId, 'funds', fundId), data, { merge: true });
  },
  async delete(userId, fundId) {
    return deleteDoc(docRef(userId, 'funds', fundId));
  },
  colRef(userId) { return colRef(userId, 'funds'); },
  docRef(userId, fundId) { return docRef(userId, 'funds', fundId); }
};

// ===== FOF Dictionary DAO =====
export const fofDictDao = {
  async get(userId, fundCode) {
    const snap = await getDoc(docRef(userId, 'fof_dict', fundCode));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },
  async set(userId, fundCode, data) {
    return setDoc(docRef(userId, 'fof_dict', fundCode), data, { merge: true });
  },
  async getAll(userId) {
    const snap = await getDocs(colRef(userId, 'fof_dict'));
    const data = {};
    snap.forEach(d => { data[d.id] = d.data(); });
    return data;
  }
};

// ===== Memos DAO =====
export const memosDao = {
  getAll(userId, onData) {
    return onSnapshot(query(colRef(userId, 'ai_memos')), (snapshot) => {
      const data = [];
      snapshot.forEach(d => data.push({ id: d.id, ...d.data() }));
      onData(data);
    }, (err) => {
      console.error('memosDao.getAll error:', err);
    });
  },
  async save(userId, target, data) {
    return setDoc(docRef(userId, 'ai_memos', target), data, { merge: true });
  },
  async delete(userId, target) {
    return deleteDoc(docRef(userId, 'ai_memos', target));
  }
};

// ===== Todos DAO =====
export const todosDao = {
  getAll(userId, onData) {
    return onSnapshot(query(colRef(userId, 'todos')), (snapshot) => {
      const data = [];
      snapshot.forEach(d => data.push({ id: d.id, ...d.data() }));
      onData(data);
    }, (err) => {
      console.error('todosDao.getAll error:', err);
    });
  },
  async add(userId, data) {
    return addDoc(colRef(userId, 'todos'), data);
  },
  async update(userId, id, data) {
    return setDoc(docRef(userId, 'todos', id), data, { merge: true });
  },
  async delete(userId, id) {
    return deleteDoc(docRef(userId, 'todos', id));
  }
};

// ===== Settings DAO =====
export const settingsDao = {
  async get(userId) {
    const snap = await getDoc(docRef(userId, 'settings', 'general'));
    return snap.exists() ? snap.data() : null;
  },
  getAll(userId, onData) {
    return onSnapshot(docRef(userId, 'settings', 'general'), (docSnap) => {
      if (docSnap.exists()) {
        onData(docSnap.data());
      } else {
        onData(null);
      }
    }, (err) => {
      console.error('settingsDao.getAll error:', err);
    });
  },
  async set(userId, data) {
    return setDoc(docRef(userId, 'settings', 'general'), data, { merge: true });
  }
};

// ===== Scoring Snapshots DAO =====
export const scoringDao = {
  getAll(userId, onData) {
    return onSnapshot(query(colRef(userId, 'scoring_snapshots')), (snapshot) => {
      const data = [];
      snapshot.forEach(d => data.push({ id: d.id, ...d.data() }));
      onData(data);
    }, (err) => {
      console.error('scoringDao.getAll error:', err);
    });
  },
  async save(userId, date, data) {
    return setDoc(docRef(userId, 'scoring_snapshots', date), data, { merge: true });
  },
  async getRecent(userId, days = 30) {
    const snap = await getDocs(query(colRef(userId, 'scoring_snapshots')));
    const data = [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    snap.forEach(d => {
      if (d.data().date >= cutoff.toISOString().split('T')[0]) {
        data.push({ id: d.id, ...d.data() });
      }
    });
    return data.sort((a, b) => b.date?.localeCompare(a.date));
  },
  async delete(userId, id) {
    return deleteDoc(docRef(userId, 'scoring_snapshots', id));
  }
};

// ===== Conversations DAO =====
export const conversationsDao = {
  getAll(userId, onData) {
    return onSnapshot(query(colRef(userId, 'chat_convs')), (snapshot) => {
      const data = {};
      snapshot.forEach(d => {
        const docData = d.data();
        if (docData.messages?.length > 0) {
          data[d.id] = { ...docData, id: d.id };
        }
      });
      onData(data);
    }, (err) => {
      console.error('conversationsDao.getAll error:', err);
    });
  },
  async save(userId, convId, data) {
    return setDoc(docRef(userId, 'chat_convs', convId), {
      messages: data.messages,
      title: data.title,
      createdAt: data.createdAt || new Date().toISOString()
    }, { merge: true });
  },
  async delete(userId, convId) {
    return deleteDoc(docRef(userId, 'chat_convs', convId));
  },
  async updateTitle(userId, convId, title) {
    return setDoc(docRef(userId, 'chat_convs', convId), { title }, { merge: true });
  }
};

export { buildPath, colRef, docRef };
