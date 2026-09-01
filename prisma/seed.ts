import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const email = process.env.ADMIN_EMAIL ?? 'contato@guilhermemenezes.com'
  const password = process.env.ADMIN_PASSWORD ?? 'changeme123'

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      name: 'Admin',
      email,
      password: await bcrypt.hash(password, 10),
      role: Role.platform_admin,
    },
  })

  console.log(`Seeded platform_admin: ${admin.email}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
