import { tool } from 'langchain';
import { PineconeService } from '../pinecone/pinecone.service';
import { ChatAnthropic } from '@langchain/anthropic';
import { z } from 'zod';
const SearchResponseSchema = z.object({
  type: z.literal("search_result"),
  response: z.string().describe("Réponse claire reformulée"),
  citations: z.array(z.string()).describe("Articles cités : 'Art. 41', 'Art. 553'"),
  sources: z.array(z.object({
    url: z.string().url().describe("URL PDF complète"),
    numero_loi: z.string().describe("Numéro de loi : '2019-40'"),
    titre: z.string().describe("Titre de la loi"),
    article: z.string().optional().describe("Article précis"),
    pages: z.string().optional().describe("Lien pages S3")
  })).describe("Sources complètes avec liens"),
});
export const searchBeninLaw = (pineconeService: PineconeService) =>
  tool(
    async ({ question }: { question: string }) => {
      // 1️⃣ Recherche brute Pinecone
      const rawPassages = await pineconeService.searchChat(question);

      // 2️⃣ LLM reformule en réponse claire
      const reformulateModel = new ChatAnthropic({
        model: 'claude-sonnet-4-5-20250929',
        temperature: 0.1, // Précis et structuré
      }).withStructuredOutput(SearchResponseSchema); // Schema typé

      const reformulatedAnswer = await reformulateModel.invoke(`
        Question utilisateur : ${question}
        
        ${rawPassages}  // ← Maintenant enrichi avec URLs !
        
        Instructions :
        - Répondez DIRECTEMENT à la question
        - Citez les articles précis (ex: "Art. 42")
        - Listez les SOURCES avec leurs URLs PDF
        - Structurez : Résumé + Articles + Sources complètes
        - Soyez concis et juridique
        
        Retournez UNIQUEMENT le JSON valide selon le schéma.
        `);

      return reformulatedAnswer; // { type: "search_result", response: "Réponse claire..." }
    },
    {
      name: 'search_benin_law',
      description:
        'Recherche intelligente dans les lois béninoises avec réponse reformulée.',
      schema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Question juridique' },
        },
        required: ['question'],
      },
    },
  );
