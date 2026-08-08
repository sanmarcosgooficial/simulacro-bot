'use client';

import { useEffect, useState, useCallback } from 'react';
import { dashboardApi } from '@/lib/api';
import { SSE_URL } from '@/lib/api';
import { formatRelativeTime, formatCurrency } from '@/lib/utils';
import {
  Users,
  TrendingUp,
  Clock,
  CheckCircle,
  MessageSquare,
  Bot,
  Calendar,
  RefreshCw,
} from 'lucide-react';

interface DashboardStats {
  contacts: {
    total: number;
    interesados: number;
    esperandoPago: number;
    inscritos: number;
    nuevosHoy: number;
  };
  sales: {
    ventasHoy: number;
    montoHoy: number;
    precio: number;
  };
  recentConversations: any[];
  upcomingSimulacros: any[];
  agent: {
    enabled: boolean;
    model: string;
  };
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  sub,
}: {
  label: string;
  value: number | string;
  icon: any;
  color: string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <div className={`w-11 h-11 ${color} rounded-xl flex items-center justify-center`}>
          <Icon size={20} className="text-white" />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const fetchStats = useCallback(async () => {
    try {
      const res = await dashboardApi.getStats();
      setStats(res.data);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Error cargando dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();

    // SSE para actualizaciones en tiempo real
    const eventSource = new EventSource(SSE_URL);
    eventSource.addEventListener('dashboard_update', () => {
      fetchStats();
    });
    eventSource.addEventListener('new_message', () => {
      fetchStats();
    });

    return () => eventSource.close();
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Actualizado {formatRelativeTime(lastUpdate)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Estado del agente */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            stats?.agent.enabled
              ? 'bg-green-50 text-green-700'
              : 'bg-gray-100 text-gray-500'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${stats?.agent.enabled ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            Agente {stats?.agent.enabled ? 'activo' : 'inactivo'}
          </div>
          <button
            onClick={fetchStats}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Interesados"
          value={stats?.contacts.interesados || 0}
          icon={Users}
          color="bg-blue-500"
          sub={`${stats?.contacts.nuevosHoy || 0} nuevos hoy`}
        />
        <StatCard
          label="Esperando pago"
          value={stats?.contacts.esperandoPago || 0}
          icon={Clock}
          color="bg-yellow-500"
        />
        <StatCard
          label="Inscritos"
          value={stats?.contacts.inscritos || 0}
          icon={CheckCircle}
          color="bg-green-500"
        />
        <StatCard
          label="Ventas hoy"
          value={formatCurrency(stats?.sales.montoHoy || 0)}
          icon={TrendingUp}
          color="bg-purple-500"
          sub={`${stats?.sales.ventasHoy || 0} inscripciones`}
        />
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Conversaciones recientes */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between p-5 border-b border-gray-50">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <MessageSquare size={16} className="text-gray-400" />
              Conversaciones recientes
            </h2>
          </div>
          <div className="divide-y divide-gray-50">
            {stats?.recentConversations.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">
                No hay conversaciones aún
              </p>
            )}
            {stats?.recentConversations.map((conv) => (
              <div key={conv.id} className="px-5 py-3.5 flex items-center justify-between hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold text-xs flex-shrink-0">
                    {(conv.contactName || conv.phone)?.[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {conv.contactName || conv.phone}
                    </p>
                    <p className="text-xs text-gray-400 truncate max-w-[200px]">
                      {conv.lastMessagePreview || 'Sin mensajes'}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {formatRelativeTime(conv.lastMessageAt)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Próximos simulacros */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between p-5 border-b border-gray-50">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Calendar size={16} className="text-gray-400" />
              Próximos simulacros
            </h2>
          </div>
          <div className="divide-y divide-gray-50">
            {stats?.upcomingSimulacros.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">
                No hay simulacros programados
              </p>
            )}
            {stats?.upcomingSimulacros.map((sim) => (
              <div key={sim.id} className="px-5 py-3.5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{sim.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {sim.date} · {sim.time}
                    </p>
                    {sim.area && (
                      <span className="inline-block mt-1 text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                        {sim.area}
                      </span>
                    )}
                  </div>
                  <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-medium">
                    Virtual
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
