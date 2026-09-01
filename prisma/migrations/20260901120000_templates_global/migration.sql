-- DropForeignKey
ALTER TABLE "Template" DROP CONSTRAINT "Template_companyId_fkey";

-- AlterTable
ALTER TABLE "Template" DROP COLUMN "companyId";
