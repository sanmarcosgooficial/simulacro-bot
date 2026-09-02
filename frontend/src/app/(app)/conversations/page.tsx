'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { conversationsApi, contactsApi, settingsApi, SSE_URL } from '@/lib/api';
import {
  formatRelativeTime,
  formatTime,
  getStatusLabel,
  getStatusColor,
} from '@/lib/utils';
import { MessageSquare, Bot, BotOff, Search, User, ArrowLeft } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'agent';
  type: string;
  content: string;
  mediaUrl?: string;
  createdAt: string;
}

interface Conversation {
  id: string;
  phone: string;
  contactId: string;
  contactName: string;
  isAgentPaused: boolean;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  career: string;
  area: string;
  status: string;
  notes: string;
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [botEnabled, setBotEnabled] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchConversations = useCallback(async () => {
    try {
      const [convRes, settingsRes] = await Promise.all([
        conversationsApi.getAll(),
        settingsApi.getAll(),
      ]);
      setConversations(convRes.data);
      setBotEnabled(settingsRes.data.agent_enabled !== 'false');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();

    const es = new EventSource(SSE_URL);
    es.addEventListener('new_message', (e: any) => {
      const data = JSON.parse(e.data);
      fetchConversations();
      if (selectedConv && data.conversationId === selectedConv.id) {
        loadMessages(selectedConv.id);
      }
    });
    es.addEventListener('conversation_updated', (e: any) => {
      const updated = JSON.parse(e.data);
      fetchConversations();
      if (selectedConv && updated.id === selectedConv.id) {
        setSelectedConv((prev: any) => prev ? { ...prev, ...updated } : prev);
      }
    });
    return () => es.close();
  }, [fetchConversations, selectedConv]);

  const loadMessages = useCallback(async (convId: string) => {
    setLoadingMsgs(true);
    try {
      const res = await conversationsApi.getMessages(convId);
      setMessages(res.data);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  const handleSelectConv = async (conv: Conversation) => {
    setSelectedConv(conv);
    setMobileView('chat');
    setContact(null);
    loadMessages(conv.id);
    conversationsApi.markAsRead(conv.id);

    if (conv.contactId) {
      try {
        const res = await contactsApi.getOne(conv.contactId);
        setContact(res.data);
      } catch {}
    }
  };

  const handleToggleBotGlobal = async () => {
    const newVal = !botEnabled;
    setBotEnabled(newVal);
    try {
      await settingsApi.update({ agent_enabled: newVal ? 'true' : 'false' });
    } catch {
      setBotEnabled(!newVal);
    }
  };

  const handleToggleAgent = async () => {
    if (!selectedConv) return;
    const newPaused = !selectedConv.isAgentPaused;
    await conversationsApi.toggleAgent(selectedConv.id, newPaused);
    setSelectedConv({ ...selectedConv, isAgentPaused: newPaused });
    fetchConversations();
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!contact) return;
    try {
      await contactsApi.update(contact.id, { status: newStatus });
      setContact({ ...contact, status: newStatus });
    } catch (err) {
      alert('Error al actualizar estado');
    }
  };

  const filtered = conversations.filter(
    (c) =>
      !search ||
      c.contactName?.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search),
  );

  return (
    <div className="flex h-full">
      {/* Lista de conversaciones */}
      <div className={`${mobileView === 'chat' ? 'hidden' : 'flex'} md:flex w-full md:w-72 flex-shrink-0 border-r border-gray-100 bg-white flex-col`}>
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Conversaciones</h2>
            <button
              type="button"
              onClick={handleToggleBotGlobal}
              title={botEnabled ? 'Bot activo — click para pausar' : 'Bot pausado — click para activar'}
              className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
                botEnabled ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                botEnabled ? 'translate-x-5' : 'translate-x-1'
              }`} />
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <MessageSquare size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-xs">Sin conversaciones</p>
            </div>
          ) : (
            filtered.map((conv) => (
              <button
                key={conv.id}
                onClick={() => handleSelectConv(conv)}
                className={`w-full text-left px-4 py-3.5 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                  selectedConv?.id === conv.id ? 'bg-blue-50' : ''
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold text-sm flex-shrink-0 mt-0.5">
                    {(conv.contactName || conv.phone)?.[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {conv.contactName || conv.phone}
                      </p>
                      {conv.unreadCount > 0 && (
                        <span className="w-4.5 h-4.5 bg-blue-600 text-white text-xs rounded-full flex items-center justify-center ml-1 flex-shrink-0">
                          {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 truncate mt-0.5">
                      {conv.lastMessagePreview || 'Sin mensajes'}
                    </p>
                    <p className="text-xs text-gray-300 mt-0.5">
                      {conv.lastMessageAt ? formatRelativeTime(conv.lastMessageAt) : ''}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Panel de mensajes */}
      {!selectedConv ? (
        <div className="hidden md:flex flex-1 items-center justify-center bg-gray-50 text-gray-400">
          <div className="text-center">
            <MessageSquare size={48} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">Selecciona una conversación</p>
          </div>
        </div>
      ) : (
        <div className={`${mobileView === 'list' ? 'hidden' : 'flex'} md:flex flex-1 flex-col min-w-0`}>
          {/* Header del chat */}
          <div className="bg-white border-b border-gray-100 px-5 py-3.5 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <button onClick={() => setMobileView('list')} className="md:hidden text-gray-400 hover:text-gray-700 mr-1">
                <ArrowLeft size={20} />
              </button>
              <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold">
                {(selectedConv.contactName || selectedConv.phone)?.[0]?.toUpperCase()}
              </div>
              <div>
                <p className="font-medium text-gray-900 text-sm">
                  {selectedConv.contactName || selectedConv.phone}
                </p>
                <p className="text-xs text-gray-400">{selectedConv.phone}</p>
              </div>
            </div>
            <button
              onClick={handleToggleAgent}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm ${
                selectedConv.isAgentPaused
                  ? 'bg-orange-500 text-white hover:bg-orange-600'
                  : 'bg-green-500 text-white hover:bg-green-600'
              }`}
            >
              {selectedConv.isAgentPaused ? (
                <>
                  <BotOff size={15} />
                  Bot pausado — activar
                </>
              ) : (
                <>
                  <Bot size={15} />
                  Bot activo — pausar
                </>
              )}
            </button>
          </div>

          <div className="flex-1 flex min-h-0">
            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
              {loadingMsgs ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent" />
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center text-gray-400 text-sm py-8">
                  No hay mensajes aún
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-white border border-gray-100 text-gray-900 rounded-tl-sm'
                          : 'bg-blue-600 text-white rounded-tr-sm'
                      }`}
                    >
                      {msg.type === 'image' && msg.mediaUrl ? (
                        <img
                          src={msg.mediaUrl}
                          alt="Imagen"
                          className="rounded-xl max-w-full"
                        />
                      ) : (
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      )}
                      <p className={`text-xs mt-1 ${msg.role === 'user' ? 'text-gray-400' : 'text-blue-200'}`}>
                        {formatTime(msg.createdAt)}
                        {msg.role === 'assistant' && ' · IA'}
                        {msg.role === 'agent' && ' · Admin'}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Panel de contacto - solo desktop */}
            <div className="hidden md:block w-64 flex-shrink-0 border-l border-gray-100 bg-white p-4 overflow-y-auto">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Información
              </h3>

              {contact ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400">Nombre</label>
                    <p className="text-sm font-medium text-gray-900">{contact.name || '—'}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400">Teléfono</label>
                    <p className="text-sm text-gray-700">{contact.phone}</p>
                  </div>
                  {contact.career && (
                    <div>
                      <label className="text-xs text-gray-400">Carrera</label>
                      <p className="text-sm text-gray-700">{contact.career}</p>
                    </div>
                  )}
                  {contact.area && (
                    <div>
                      <label className="text-xs text-gray-400">Área</label>
                      <p className="text-sm text-blue-600 font-medium">{contact.area}</p>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-gray-400 block mb-1.5">Estado</label>
                    <select
                      value={contact.status}
                      onChange={(e) => handleStatusChange(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="nuevo">Nuevo</option>
                      <option value="interesado">Interesado</option>
                      <option value="esperando_pago">Esperando pago</option>
                      <option value="inscrito">Inscrito</option>
                    </select>
                  </div>
                  {contact.notes && (
                    <div>
                      <label className="text-xs text-gray-400">Notas</label>
                      <p className="text-xs text-gray-600 mt-0.5">{contact.notes}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                  <User size={28} className="mb-2 opacity-30" />
                  <p className="text-xs text-center">Sin información de contacto</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
