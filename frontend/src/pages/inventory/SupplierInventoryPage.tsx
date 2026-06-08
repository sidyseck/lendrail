// src/pages/inventory/SupplierInventoryPage.tsx — F-062

import { useCustodianInventory } from '@/hooks/useCustodianInventory';
import { useAgentAllocations } from '@/hooks/useAgentAllocations';
import { CustodianPositionsSection } from './CustodianPositionsSection';
import { AgentAllocationPanels } from './AgentAllocationPanels';

export function SupplierInventoryPage() {
  const custodianInv = useCustodianInventory();
  const agentAllocs = useAgentAllocations();

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Inventory Management</h1>
        <p className="mt-1 text-sm text-gray-500">
          View your custodian positions and manage how much you've published to each agent.
        </p>
      </div>

      {/* Section A — Custodian positions */}
      <section>
        <h2 className="mb-3 text-base font-medium text-gray-800">Custodian positions</h2>
        <CustodianPositionsSection
          items={custodianInv.items}
          isLoading={custodianInv.isLoading}
          error={custodianInv.error}
        />
      </section>

      {/* Section B+C — Agent allocations */}
      <section>
        <h2 className="mb-3 text-base font-medium text-gray-800">
          Published to agents
        </h2>
        {agentAllocs.error ? (
          <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {agentAllocs.error}
          </div>
        ) : (
          <AgentAllocationPanels
            allocations={agentAllocs.allocations}
            onSaved={agentAllocs.refetchConnection}
          />
        )}
      </section>
    </div>
  );
}
