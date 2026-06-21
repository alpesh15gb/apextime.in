-- AlterTable: Add ESSL-equivalent attendance calculation fields to WorkShift
ALTER TABLE "work_shifts" ADD COLUMN "half_day_mins" INTEGER NOT NULL DEFAULT 240;
ALTER TABLE "work_shifts" ADD COLUMN "absent_day_mins" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "work_shifts" ADD COLUMN "half_day_late_mins" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "work_shifts" ADD COLUMN "half_day_early_mins" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "work_shifts" ADD COLUMN "early_grace_mins" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "work_shifts" ADD COLUMN "ot_formula" TEXT NOT NULL DEFAULT 'total_duration_minus_shift';
ALTER TABLE "work_shifts" ADD COLUMN "max_ot_hours" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "work_shifts" ADD COLUMN "mark_absent_for_late" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "work_shifts" ADD COLUMN "continuous_late_days" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "work_shifts" ADD COLUMN "absent_day_type" TEXT NOT NULL DEFAULT 'full_day';
ALTER TABLE "work_shifts" ADD COLUMN "break1_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "work_shifts" ADD COLUMN "break1_start" TEXT NOT NULL DEFAULT '13:00';
ALTER TABLE "work_shifts" ADD COLUMN "break1_end" TEXT NOT NULL DEFAULT '13:30';
ALTER TABLE "work_shifts" ADD COLUMN "break2_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "work_shifts" ADD COLUMN "break2_start" TEXT NOT NULL DEFAULT '17:00';
ALTER TABLE "work_shifts" ADD COLUMN "break2_end" TEXT NOT NULL DEFAULT '17:30';
-- Add protocol field for AI/Non-AI device selection
ALTER TABLE "devices" ADD COLUMN "protocol" TEXT NOT NULL DEFAULT 'attlog';
ALTER TABLE "work_shifts" ADD COLUMN "punch_begin_duration" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "work_shifts" ADD COLUMN "punch_end_duration" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "work_shifts" ADD COLUMN "consider_early_punch" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "work_shifts" ADD COLUMN "consider_late_punch" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable: Holiday
CREATE TABLE "holidays" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "holiday_year_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "holidays_uuid_key" ON "holidays"("uuid");
CREATE UNIQUE INDEX "holidays_tenant_id_holiday_year_id_date_key" ON "holidays"("tenant_id", "holiday_year_id", "date");
CREATE INDEX "holidays_tenant_id_date_idx" ON "holidays"("tenant_id", "date");

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_holiday_year_id_fkey" FOREIGN KEY ("holiday_year_id") REFERENCES "holiday_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
