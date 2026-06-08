// src/pages/inventory/AgentAvailableInventoryPage.tsx — F-063

import { useEffect } from 'react';
import { useAgentInventory } from '@/hooks/useAgentInventory';
import { useAllocationNotifications } from '@/hooks/useAllocationNotifications';
import { AggregatedInventorySection } from './AggregatedInventorySection';
import { SupplierBreakdownSection } from './SupplierBreakdownSection';

export function AgentAvailableInventoryPage() {
  const inventory = useAgentInventory();
  const notifications = useAllocationNotifications(true);

  useEffect(() => {
    void notifications.onScreenVisit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Available Inventory</h1>
        <p className="mt-1 text-sm text-gray-500">
          Inventory available to you across all active supplier connections.
        </p>
      </div>

      <AggregatedInventorySection
        aggregated={inventory.aggregated}
        isLoading={inventory.isLoading}
        error={inventory.error}
      />

      <SupplierBreakdownSection
        breakdown={inventory.breakdown}
        isLoading={inventory.isLoading}
        highlightedConnections={notifications.highlightedConnections}
      />
    </div>
  );
}
