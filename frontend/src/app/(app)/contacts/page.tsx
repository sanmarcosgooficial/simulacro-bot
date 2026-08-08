'use client';

import { useState, useEffect, useCallback } from 'react';
import { contactsApi } from '@/lib/api';
import { getStatusLabel, getStatusColor, formatRelativeTime } from '@/lib/utils';
import { Search, Plus, X, Edit2, Trash2, CheckCircle } from 'lucide-react';

const STATUSES = [
  { value: '', label: 'Todos' },
  { value: 'nuevo', label: 'Nuevo' },
  { value: 'interesado', label: 'Interesado' },
  { value: 'esperando_pago', label: 'Esperando pago' },
  { value: 'inscrito', label: 'Inscrito' },
];

interface Contact {
  id: string;
  name: string;
  phone: string;
  career: string;
  area: string;
  status: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

function ContactModal({
  contact,
  onClose,
  onSave,
}: {
  contact: Contact | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [form, setForm] = useState({
    name: contact?.name || '',
    phone: contact?.phone || '',
    career: contact?.career || '',
    area: contact?.area || '',
    status: contact?.status || 'nuevo',
    notes: contact?.notes || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (contact) {
        await contactsApi.update(contact.id, form);
      } else {
        await contactsApi.create(form);
      }
      onSave();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al guardar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">
            {contact ? 'Editar contacto' : 'Nuevo contacto'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Nombre</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Juan Pérez"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Teléfono *</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                required
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="+51999999999"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Carrera</label>
              <input
                type="text"
                value={form.career}
                onChange={(e) => setForm({ ...form, career: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Medicina"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Área</label>
              <input
                type="text"
                value={form.area}
                onChange={(e) => setForm({ ...form, area: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Biomédicas"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Estado</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="nuevo">Nuevo</option>
              <option value="interesado">Interesado</option>
              <option value="esperando_pago">Esperando pago</option>
              <option value="inscrito">Inscrito</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notas</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Notas adicionales..."
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {loading ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await contactsApi.getAll({ search, status: statusFilter || undefined });
      setContacts(res.data);
    } catch (err) {
      console.error('Error cargando contactos:', err);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(fetchContacts, 300);
    return () => clearTimeout(timer);
  }, [fetchContacts]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar a ${name || 'este contacto'}?`)) return;
    try {
      await contactsApi.delete(id);
      fetchContacts();
    } catch (err) {
      alert('Error al eliminar el contacto');
    }
  };

  const handleConfirmPayment = async (contact: Contact) => {
    if (!confirm(`¿Confirmar pago de ${contact.name || contact.phone}?`)) return;
    try {
      await contactsApi.update(contact.id, { status: 'inscrito' });
      fetchContacts();
    } catch (err) {
      alert('Error al confirmar el pago');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">CRM</h1>
          <p className="text-sm text-gray-500 mt-0.5">{contacts.length} contactos</p>
        </div>
        <button
          onClick={() => { setEditContact(null); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Plus size={16} />
          Nuevo contacto
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, teléfono o carrera..."
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatusFilter(s.value)}
              className={`px-3 py-2 text-xs font-medium rounded-xl transition-colors ${
                statusFilter === s.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-sm">No se encontraron contactos</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-50">
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Nombre</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Teléfono</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Carrera / Área</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Estado</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Actualizado</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {contacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold text-xs flex-shrink-0">
                          {(contact.name || contact.phone)?.[0]?.toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-gray-900">
                          {contact.name || '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{contact.phone}</td>
                    <td className="px-5 py-3.5">
                      <div>
                        <p className="text-sm text-gray-900">{contact.career || '—'}</p>
                        {contact.area && (
                          <p className="text-xs text-gray-400">{contact.area}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(contact.status)}`}>
                        {getStatusLabel(contact.status)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-gray-400">
                      {formatRelativeTime(contact.updatedAt)}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1">
                        {contact.status === 'esperando_pago' && (
                          <button
                            onClick={() => handleConfirmPayment(contact)}
                            title="Confirmar pago"
                            className="p-1.5 text-green-500 hover:bg-green-50 rounded-lg transition-colors"
                          >
                            <CheckCircle size={15} />
                          </button>
                        )}
                        <button
                          onClick={() => { setEditContact(contact); setShowModal(true); }}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Edit2 size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(contact.id, contact.name)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <ContactModal
          contact={editContact}
          onClose={() => setShowModal(false)}
          onSave={fetchContacts}
        />
      )}
    </div>
  );
}
