'use client';

import { useState, useEffect } from 'react';
import { settingsApi, API_BASE } from '@/lib/api';
import { Settings, Save, Trash2, ImagePlus, Tag } from 'lucide-react';

const OPENAI_MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini — Recomendado (rápido y económico)' },
  { value: 'gpt-4o', label: 'GPT-4o — Mayor calidad' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini — Equilibrio calidad/precio' },
];

export default function SettingsPage() {
  const [form, setForm] = useState({
    business_name: '',
    price: '',
    yape_number: '',
    yape_name: '',
    agent_tone: 'amigable',
    ai_model: 'gpt-4o-mini',
    welcome_message: '',
  });
  const [promoEnabled, setPromoEnabled] = useState(false);
  const [promoFlyerUrl, setPromoFlyerUrl] = useState('');
  const [promoFlyerFile, setPromoFlyerFile] = useState<File | null>(null);
  const [promoFlyerPreview, setPromoFlyerPreview] = useState('');
  const [uploadingPromoFlyer, setUploadingPromoFlyer] = useState(false);
  const [promoSaved, setPromoSaved] = useState(false);

  const [testPhone, setTestPhone] = useState('');
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    settingsApi.getAll().then((res) => {
      const d = res.data;
      setForm({
        business_name: d.business_name || '',
        price: d.price || '',
        yape_number: d.yape_number || '',
        yape_name: d.yape_name || '',
        agent_tone: d.agent_tone || 'amigable',
        ai_model: d.ai_model || 'gpt-4o-mini',
        welcome_message: d.welcome_message || '',
      });
      setPromoEnabled(d.promo_enabled === 'true');
      if (d.promo_flyer_url) {
        const url = d.promo_flyer_url.startsWith('http') ? d.promo_flyer_url : `${API_BASE}${d.promo_flyer_url}`;
        setPromoFlyerUrl(url);
        setPromoFlyerPreview(url);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const updates: Record<string, string> = { ...form };
      // Si se ingresó una API key, incluirla
      // La API key se guarda en .env del backend, no en DB por seguridad
      await settingsApi.update(updates);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">


      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
          <Settings size={20} className="text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Configuración</h1>
          <p className="text-sm text-gray-500">Personaliza el comportamiento del sistema</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* Negocio */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Información del negocio</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Nombre del negocio</label>
              <input
                type="text"
                value={form.business_name}
                onChange={(e) => setForm({ ...form, business_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Precio del simulacro (S/)</label>
                <input
                  type="number"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Pago */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Datos de pago (Yape)</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Número de Yape</label>
              <input
                type="text"
                value={form.yape_number}
                onChange={(e) => setForm({ ...form, yape_number: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="948257314"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Nombre del titular</label>
              <input
                type="text"
                value={form.yape_name}
                onChange={(e) => setForm({ ...form, yape_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Juan Pérez"
              />
            </div>
          </div>
        </div>

        {/* Agente IA */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="mb-4">
            <h2 className="font-semibold text-gray-900">Agente IA</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Tono del agente</label>
              <select
                value={form.agent_tone}
                onChange={(e) => setForm({ ...form, agent_tone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="amigable">Amigable</option>
                <option value="formal">Formal</option>
                <option value="cercano">Cercano y coloquial</option>
                <option value="profesional">Profesional</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Modelo de IA (OpenAI)</label>
              <select
                value={form.ai_model}
                onChange={(e) => setForm({ ...form, ai_model: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {OPENAI_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Mensaje de bienvenida</label>
              <textarea
                value={form.welcome_message}
                onChange={(e) => setForm({ ...form, welcome_message: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Promo */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
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
            Inscríbete al 2do simulacro y el 3ro te sale gratis. Se ofrece justo después de que el cliente elige horario.
          </p>

          {/* Flyer de la promo */}
          <label className="block text-xs font-medium text-gray-700 mb-2">Flyer de la promo (con las 3 fechas)</label>
          <div className="flex items-start gap-4">
            {/* Preview */}
            <div className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0 bg-gray-50">
              {promoFlyerPreview ? (
                <img src={promoFlyerPreview} alt="Flyer promo" className="w-full h-full object-cover" />
              ) : (
                <ImagePlus size={22} className="text-gray-300" />
              )}
            </div>
            <div className="flex-1 space-y-2">
              <label className="flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl cursor-pointer text-sm text-gray-600 transition-colors">
                <ImagePlus size={14} />
                {promoFlyerPreview ? 'Cambiar flyer de promo' : 'Subir flyer de promo'}
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
                      setPromoFlyerUrl(data.url);
                      setPromoFlyerFile(null);
                      setPromoSaved(true);
                      setTimeout(() => setPromoSaved(false), 3000);
                    } catch {
                      alert('Error subiendo el flyer de promo');
                    } finally {
                      setUploadingPromoFlyer(false);
                    }
                  }}
                  className="w-full py-2 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors"
                >
                  {uploadingPromoFlyer ? 'Subiendo...' : 'Guardar flyer de promo'}
                </button>
              )}
              {promoSaved && (
                <p className="text-xs text-green-600">✓ Flyer de promo guardado</p>
              )}
              {promoFlyerUrl && !promoFlyerFile && (
                <p className="text-xs text-gray-400 truncate">✓ Flyer configurado</p>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">
            {error}
          </div>
        )}

        {saved && (
          <div className="bg-green-50 border border-green-200 text-green-600 text-sm px-4 py-3 rounded-xl">
            ✓ Configuración guardada correctamente
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Save size={15} />
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </form>

      {/* Zona de pruebas */}
      <div className="mt-5 bg-white rounded-2xl border border-orange-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
          <Trash2 size={16} className="text-orange-500" />
          Limpiar datos
        </h2>
        <p className="text-xs text-gray-400 mb-3">
          Borra mensajes, conversación y contacto.
        </p>

        {/* Botón rápido: limpia todos los TEST_PHONES del .env de un clic */}
        <button
          onClick={async () => {
            if (!confirm('¿Limpiar todos los datos de tus números de prueba?')) return;
            setClearing(true);
            setClearResult('');
            try {
              const res = await settingsApi.clearTestPhones();
              setClearResult(`✓ ${res.data.message}`);
            } catch (err: any) {
              setClearResult('Error: ' + (err.response?.data?.message || err.message));
            } finally {
              setClearing(false);
            }
          }}
          disabled={clearing}
          className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 mb-4"
        >
          <Trash2 size={14} />
          {clearing ? 'Limpiando...' : 'Limpiar mis números de prueba'}
        </button>

        {/* Manual: limpiar un número específico */}
        <p className="text-xs text-gray-400 mb-2">O limpia un número específico:</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="969016578"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          <button
            onClick={async () => {
              if (!testPhone) return;
              const digits = testPhone.replace(/\s/g, '').replace(/^\+/, '');
              const normalized = digits.length === 9 ? `+51${digits}` : `+${digits}`;
              if (!confirm(`¿Borrar todos los datos de ${normalized}?`)) return;
              setClearing(true);
              setClearResult('');
              try {
                const res = await settingsApi.clearTestData(normalized);
                const d = res.data.deleted;
                setClearResult(`✓ Eliminado: ${d.mensajes} mensajes, ${d.conversaciones} conv., ${d.contactos} contacto`);
                setTestPhone('');
              } catch (err: any) {
                setClearResult('Error: ' + (err.response?.data?.message || err.message));
              } finally {
                setClearing(false);
              }
            }}
            disabled={clearing || !testPhone}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-sm font-medium rounded-xl transition-colors whitespace-nowrap"
          >
            Limpiar
          </button>
        </div>

        {clearResult && (
          <p className={`text-xs mt-2 ${clearResult.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
            {clearResult}
          </p>
        )}
      </div>
    </div>
  );
}
