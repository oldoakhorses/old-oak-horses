"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export default function DashboardPage() {
  const bills = useQuery(api.bills.listAll) ?? [];

  return (
    <section className="panel">
      <h1>Bill Dashboard</h1>
      <p>
        <small>Live status updates are powered by Convex subscriptions.</small>
      </p>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Uploaded</th>
            <th>Status</th>
            <th>Billing Period</th>
            <th>Amount</th>
            <th>Due Date</th>
            <th>Account #</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((bill) => (
            <tr key={bill._id}>
              <td>{bill.providerName}</td>
              <td>{new Date(bill.uploadedAt).toLocaleString()}</td>
              <td>{bill.status}</td>
              <td>{bill.extractedData?.billingPeriod ?? bill.billingPeriod}</td>
              <td>
                {typeof bill.extractedData?.amount === "number"
                  ? `$${bill.extractedData.amount.toFixed(2)}`
                  : "-"}
              </td>
              <td>{bill.extractedData?.dueDate ?? "-"}</td>
              <td>{bill.extractedData?.accountNumber ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
