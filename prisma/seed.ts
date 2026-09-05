import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Sem defaults: uma password de exemplo acaba em produção. Ambas vêm do
  // ambiente (ver .env.example).
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) {
    throw new Error('ADMIN_EMAIL e ADMIN_PASSWORD são obrigatórias para o seed')
  }
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD deve ter pelo menos 12 caracteres')
  }

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
