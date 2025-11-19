import { tool } from "langchain";
import { PineconeService } from "../pinecone/pinecone.service";

export const searchBeninLaw = (pineconeService: PineconeService) =>
  tool(
    async ({ question }: { question: string }) => {
    return   await pineconeService.search(question);
    },
    {
      name: "search_benin_law",
      description: "Recherche dans les lois béninoises (Pinecone + Mistral embedding).",
      schema: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "Question juridique ou problème à analyser",
          },
        },
        required: ["question"],
      },
    }
  );
