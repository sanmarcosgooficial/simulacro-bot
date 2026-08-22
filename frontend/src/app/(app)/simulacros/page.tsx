'use client';

import { useState, useEffect, useCallback } from 'react';
import { simulacrosApi, settingsApi, API_BASE } from '@/lib/api';

// Construye URL absoluta para imágenes guardadas como path relativo
const imgUrl = (path: string) =>
  path?.startsWith('http') ? path : `${API_BASE}${path}`;
import { getSimStatusLabel, getSimStatusColor } from '@/lib/utils';
import { Plus, X, Edit2, Trash2, Calendar, Clock, ImagePlus, Tag } from 'lucide-react';

interface Simulacro {
  id: string;
  title: string;
  date: string;
  time: string;
  schedules: string[];
  area: string;
  status: string;
  description: string;
  flyerUrl: string;
  isVirtual: boolean;
  createdAt: string;
}

const AREAS: { value: string; label: string }[] = [
  { value: 'Área A: Ciencias de la Salud',                        label: 'Área A: Ciencias de la Salud' },
  { value: 'Área B: Ciencias Básicas',                            label: 'Área B: Ciencias Básicas' },
  { value: 'Área C: Ingeniería',                                  label: 'Área C: Ingeniería' },
  { value: 'Área D: Ciencias Económicas y de la Gestión',         label: 'Área D: C. Económicas y Gestión' },
  { value: 'Área E: Humanidades y Ciencias Jurídicas y Sociales', label: 'Área E: Humanidades y C. Sociales' },
];

function SimulacroModal({
  simulacro,
  onClose,
  onSave,
}: {
  simulacro: Simulacro | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const todayStr = new Date().toISOString().split('T')[0];

  const [form, setForm] = useState({
    title: simulacro?.title || (() => {
      const d = new Date();
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yy = String(d.getFullYear()).slice(2);
      return `${dd}/${mm}/${yy}`;
    })(),
    date: simulacro?.date || todayStr,
    time: simulacro?.time || '10:00',
    area: simulacro?.area || '',
    status: simulacro?.status || 'disponible',
    description: simulacro?.description || '',
  });
  // Parsear strings "HH:MM - HH:MM" a objetos {from, to}
  const parseSchedule = (s: string) => {
    const parts = s.split(' - ');
    return { from: parts[0]?.trim() || '', to: parts[1]?.trim() || '' };
  };
  const [schedules, setSchedules] = useState<{ from: string; to: string }[]>(
    simulacro?.schedules?.length
      ? simulacro.schedules.map(parseSchedule)
      : [{ from: '10:00', to: '13:00' }, { from: '17:00', to: '20:00' }]
  );
  const [flyerFile, setFlyerFile] = useState<File | null>(null);
  const [flyerPreview, setFlyerPreview] = useState<string>(
    simulacro?.flyerUrl ? imgUrl(simulacro.flyerUrl) : ''
  );
  const [uploadingFlyer, setUploadingFlyer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFlyerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFlyerFile(file);
    setFlyerPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const cleanSchedules = schedules
        .filter((s) => s.from && s.to)
        .map((s) => `${s.from} - ${s.to}`);
      const payload = { ...form, schedules: cleanSchedules };

      let savedId: string;
      if (simulacro) {
        await simulacrosApi.update(simulacro.id, payload);
        savedId = simulacro.id;
      } else {
        const res = await simulacrosApi.create(payload);
        savedId = res.data.id;
      }

      // Subir flyer si se seleccionó uno
      if (flyerFile) {
        setUploadingFlyer(true);
        await simulacrosApi.uploadFlyer(savedId, flyerFile);
        setUploadingFlyer(false);
      }

      onSave();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al guardar');
    } finally {
      setLoading(false);
      setUploadingFlyer(false);
    }
  };

  const buttonLabel = () => {
    if (uploadingFlyer) return 'Subiendo flyer...';
    if (loading) return 'Guardando...';
    return 'Guardar';
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">
            {simulacro ? 'Editar simulacro' : 'Nuevo simulacro'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Nombre del simulacro *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="San Marcos Las Fijas"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Fecha *</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-700">Horarios disponibles *</label>
              <button
                type="button"
                onClick={() => setSchedules([...schedules, { from: '', to: '' }])}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                <Plus size={12} /> Agregar horario
              </button>
            </div>
            <div className="space-y-2">
              {schedules.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="time"
                      value={s.from}
                      onChange={(e) => {
                        const updated = [...schedules];
                        updated[i] = { ...updated[i], from: e.target.value };
                        setSchedules(updated);
                      }}
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-gray-400 text-xs flex-shrink-0">hasta</span>
                    <input
                      type="time"
                      value={s.to}
                      onChange={(e) => {
                        const updated = [...schedules];
                        updated[i] = { ...updated[i], to: e.target.value };
                        setSchedules(updated);
                      }}
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  {schedules.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSchedules(schedules.filter((_, j) => j !== i))}
                      className="text-gray-300 hover:text-red-500 transition-colors"
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Área</label>
              <select
                value={form.area}
                onChange={(e) => setForm({ ...form, area: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Todas las áreas</option>
                {AREAS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Estado</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="disponible">Disponible</option>
                <option value="finalizado">Finalizado</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>
          </div>

          {/* Flyer */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Flyer del simulacro</label>
            {flyerPreview && (
              <div className="mb-2">
                <img src={flyerPreview} alt="Flyer" className="w-24 h-24 object-cover rounded-xl border border-gray-100" />
                <p className="text-xs text-green-600 mt-1">✓ Flyer cargado</p>
              </div>
            )}
            <label className="flex items-center gap-2 cursor-pointer w-fit">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFlyerChange}
              />
              <span className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 text-sm font-medium rounded-xl transition-colors flex items-center gap-2">
                <ImagePlus size={15} />
                {flyerPreview ? 'Cambiar flyer' : 'Subir flyer'}
              </span>
            </label>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Descripción (opcional)</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Información adicional..."
            />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || uploadingFlyer}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {buttonLabel()}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SimulacrosPage() {
  const [simulacros, setSimulacros] = useState<Simulacro[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<Simulacro | null>(null);

  // Promo
  const [promoEnabled, setPromoEnabled] = useState(false);
  const [promoFlyerFile, setPromoFlyerFile] = useState<File | null>(null);
  const [promoFlyerPreview, setPromoFlyerPreview] = useState('');
  const [uploadingPromoFlyer, setUploadingPromoFlyer] = useState(false);
  const [promoSaved, setPromoSaved] = useState(false);

  const fetchSimulacros = useCallback(async () => {
    setLoading(true);
    try {
      const res = await simulacrosApi.getAll();
      setSimulacros(res.data);
    } catch (err) {
      console.error('Error cargando simulacros:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSimulacros();
    // Cargar estado de la promo
    settingsApi.getAll().then((res) => {
      const d = res.data;
      setPromoEnabled(d.promo_enabled === 'true');
      if (d.promo_flyer_url) {
        const url = d.promo_flyer_url.startsWith('http') ? d.promo_flyer_url : `${API_BASE}${d.promo_flyer_url}`;
        setPromoFlyerPreview(url);
      }
    }).catch(() => {});
  }, [fetchSimulacros]);

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`¿Eliminar "${title}"?`)) return;
    try {
      await simulacrosApi.delete(id);
      fetchSimulacros();
    } catch (err) {
      alert('Error al eliminar');
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Simulacros</h1>
          <p className="text-sm text-gray-500 mt-0.5">{simulacros.length} registrados</p>
        </div>
        <button
          onClick={() => { setEditItem(null); setShowModal(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Plus size={16} />
          Nuevo simulacro
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : simulacros.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col items-center justify-center py-16 text-gray-400">
          <Calendar size={40} className="mb-3 opacity-30" />
          <p className="text-sm">No hay simulacros aún</p>
          <button
            onClick={() => { setEditItem(null); setShowModal(true); }}
            className="mt-4 text-blue-600 text-sm hover:underline"
          >
            Crear el primero
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {simulacros.map((sim) => (
            <div key={sim.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-start justify-between">
              <div className="flex gap-4 flex-1">
                {sim.flyerUrl && (
                  <img src={imgUrl(sim.flyerUrl)} alt="Flyer" className="w-14 h-14 object-cover rounded-xl border border-gray-100 flex-shrink-0" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">{sim.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getSimStatusColor(sim.status)}`}>
                      {getSimStatusLabel(sim.status)}
                    </span>
                    <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
                      Virtual
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-500 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Calendar size={13} />
                      {(() => { const [y,m,d] = sim.date.split('-'); return `${d}/${m}/${y.slice(2)}`; })()}
                    </span>
                    {sim.schedules?.length > 0 ? (
                      <span className="flex items-center gap-1">
                        <Clock size={13} />
                        {sim.schedules.join('  •  ')}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Clock size={13} />
                        {sim.time}
                      </span>
                    )}
                    {sim.area ? (
                      <span className="text-blue-600 font-medium">{sim.area}</span>
                    ) : (
                      <span className="text-gray-400">Todas las áreas</span>
                    )}
                  </div>
                  {sim.description && (
                    <p className="text-xs text-gray-400 mt-1.5">{sim.description}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 ml-4">
                <button
                  onClick={() => { setEditItem(sim); setShowModal(true); }}
                  className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                >
                  <Edit2 size={15} />
                </button>
                <button
                  onClick={() => handleDelete(sim.id, sim.title)}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Promo especial ─────────────────────────────────────────── */}
      <div className="mt-6 bg-white rounded-2xl border border-purple-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Tag size={16} className="text-purple-500" />
            Promo especial
          </h2>
          {/* Switch on/off */}
          <button
            type="button"
            onClick={async () => {
              const next = !promoEnabled;
              setPromoEnabled(next);
              await settingsApi.update({ promo_enabled: next ? 'true' : 'false' });
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              promoEnabled ? 'bg-purple-500' : 'bg-gray-200'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              promoEnabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          Cuando esté activa, el bot ofrece esta promo justo después de que el cliente elige horario del 1er simulacro:{' '}
          <span className="font-medium text-gray-600">inscríbete también al 2do y el 3ro te sale gratis.</span>
        </p>

        <div className="flex items-start gap-4">
          {/* Preview del flyer */}
          <div className="w-28 h-28 rounded-xl border-2 border-dashed border-purple-100 flex items-center justify-center overflow-hidden flex-shrink-0 bg-purple-50">
            {promoFlyerPreview ? (
              <img src={promoFlyerPreview} alt="Flyer promo" className="w-full h-full object-cover rounded-xl" />
            ) : (
              <ImagePlus size={24} className="text-purple-200" />
            )}
          </div>

          <div className="flex-1 space-y-2">
            <p className="text-xs font-medium text-gray-700">Flyer de la promo (con las 3 fechas)</p>
            <label className="flex items-center gap-2 px-3 py-2 bg-purple-50 hover:bg-purple-100 border border-purple-100 rounded-xl cursor-pointer text-sm text-purple-700 transition-colors w-fit">
              <ImagePlus size={14} />
              {promoFlyerPreview ? 'Cambiar flyer' : 'Subir flyer'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setPromoFlyerFile(file);
                  setPromoFlyerPreview(URL.createObjectURL(file));
                }}
              />
            </label>

            {promoFlyerFile && (
              <button
                type="button"
                disabled={uploadingPromoFlyer}
                onClick={async () => {
                  if (!promoFlyerFile) return;
                  setUploadingPromoFlyer(true);
                  try {
                    const formData = new FormData();
                    formData.append('file', promoFlyerFile);
                    const res = await fetch(`${API_BASE}/settings/upload-promo-flyer`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
                      body: formData,
                    });
                    const data = await res.json();
                    setPromoFlyerPreview(data.url);
                    setPromoFlyerFile(null);
                    setPromoSaved(true);
                    setTimeout(() => setPromoSaved(false), 3000);
                  } catch {
                    alert('Error subiendo el flyer de promo');
                  } finally {
                    setUploadingPromoFlyer(false);
                  }
                }}
                className="px-4 py-2 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors"
              >
                {uploadingPromoFlyer ? 'Subiendo...' : 'Guardar flyer'}
              </button>
            )}

            {promoSaved && <p className="text-xs text-green-600">✓ Flyer de promo guardado</p>}
            {promoFlyerPreview && !promoFlyerFile && !promoSaved && (
              <p className="text-xs text-gray-400">✓ Flyer configurado</p>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <SimulacroModal
          simulacro={editItem}
          onClose={() => setShowModal(false)}
          onSave={fetchSimulacros}
        />
      )}
    </div>
  );
}
