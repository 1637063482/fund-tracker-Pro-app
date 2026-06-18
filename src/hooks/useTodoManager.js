// Hook: Todo manager extracted from App.jsx
import { useState, useEffect } from 'react';
import { todosDao } from '../services/firestoreDao';
import { db } from '../config/firebase';

export function useTodoManager(user) {
  const [todos, setTodos] = useState([]);

  useEffect(() => {
    if (!user || !db) return;
    const unsub = todosDao.getAll(user.uid, (data) => { setTodos(data); });
    return () => unsub();
  }, [user]);

  const handleAddTodo = async (todoData) => {
    if (!user || !db) return;
    await todosDao.add(user.uid, todoData);
  };

  const handleUpdateTodo = async (id, newData) => {
    if (!user || !db) return;
    await todosDao.update(user.uid, id, newData);
  };

  const handleDeleteTodo = async (id) => {
    if (!user || !db) return;
    await todosDao.delete(user.uid, id);
  };

    const handleToggleTodo = async (id, isCompleted) => {
    if (!user || !db) return;
    const now = new Date().toISOString();
    await handleUpdateTodo(id, { isCompleted, completedAt: isCompleted ? now : null, updatedAt: now });
  };

  return { todos, handleAddTodo, handleUpdateTodo, handleDeleteTodo, handleToggleTodo };
}

