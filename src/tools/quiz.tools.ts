import { tool } from 'langchain';
import { PineconeService } from '../pinecone/pinecone.service';
import { ChatAnthropic } from '@langchain/anthropic';
import { z } from 'zod';

export type QuizLLM = {
  invoke(input: unknown): Promise<any>;
};

interface QuizInput {
  topic: string;
  numQuestions?: number;
}

interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswerIndex: number;
  explanation?: string;
}
const QuizQuestionSchema = z.object({
  question: z.string().describe('Texte de la question'),
  options: z
    .array(z.string())
    .min(2)
    .describe('Liste des options de réponse (au moins 2)'),
  correctAnswerIndex: z
    .number()
    .int()
    .nonnegative()
    .describe("Index (0-based) de la bonne réponse dans le tableau 'options'"),
  explanation: z
    .string()
    .optional()
    .describe('Explication courte basée sur le texte juridique'),
});

// Schéma de sortie attendu par withStructuredOutput (Anthropic exige un objet)
const QuizOutputSchema = z.object({
  questions: z.array(QuizQuestionSchema),
});
export const createLegalQuizPro = (
  pineconeService: PineconeService,
  llm: QuizLLM, // ou ton modèle Claude/Anthropic
) =>
    tool(
        async ({ topic, numQuestions = 5 }: QuizInput): Promise<QuizQuestion[]> => {
          console.log("🔍 Génération d’un quiz sur :", topic);

          // 1️⃣ Recherche dans Pinecone
          const passages = await pineconeService.search(topic);
      
          if (!passages || passages.length === 0) {
            return [];
          }
      
          const textContent = Array.isArray(passages)
            ? passages.map((p) => (typeof p === 'string' ? p : p?.content || '')).join('\n\n')
            : String(passages);
      
          // 2️⃣ Génération des questions via LLM (obligatoirement JSON)
          const model = new ChatAnthropic({
            model: "claude-sonnet-4-5-20250929",
            temperature: 0.3,
          }).withStructuredOutput(QuizOutputSchema);
      
          const prompt = `
      Tu es un expert en droit béninois.
      Génère ${numQuestions} questions de quiz basées STRICTEMENT sur les textes suivants :
      
      ${textContent}
      
      Règles :
      - Chaque question doit mentionner l'article ou le code utilisé.
      - 4 options par question.
      - Une seule bonne réponse.
      - Retourne UNIQUEMENT un JSON valide correspondant au schéma.
      `;
      
          const result = await model.invoke(prompt);
  
          return result.questions;

      
   
        },
        {
          name: "create_legal_quiz_pro",
          description:
            'Génère un quiz juridique basé sur les textes béninois, à partir des segments trouvés dans Pinecone.',
          schema: {
            type: "object",
            properties: {
              topic: {
                type: "string",
                description: "Sujet du quiz",
              },
              numQuestions: {
                type: "number",
                description: "Nombre de questions (défaut 5)",
              },
            },
            required: ["topic"],
          },
        }
      );
      
