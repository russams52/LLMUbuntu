import { db, migrate } from "./db";
import { seedAuthorities } from "./data/authorities";

migrate();
const count = seedAuthorities();
console.log(`Seeded ${count} authorities.`);
