const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const avgTime = await prisma.benchmarkSession.aggregate({
    _avg: { totalTimeMs: true },
  });
  const avgMetrics = await prisma.benchmarkSession.aggregate({
    _avg: {
      fieldAccuracy: true,
      navigationAccuracy: true,
      completionRate: true,
      avgConfidence: true,
    },
  });
  const count = await prisma.benchmarkSession.count();
  console.log(JSON.stringify({
    avgTimeMs: avgTime._avg.totalTimeMs,
    avgFieldAccuracy: avgMetrics._avg.fieldAccuracy,
    avgNavigationAccuracy: avgMetrics._avg.navigationAccuracy,
    avgCompletionRate: avgMetrics._avg.completionRate,
    avgConfidence: avgMetrics._avg.avgConfidence,
    totalSessions: count,
  }));
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
