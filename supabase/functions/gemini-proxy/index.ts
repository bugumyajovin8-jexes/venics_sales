import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import { GoogleGenAI } from 'npm:@google/genai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Check Authentication via Supabase
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser()

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Hakuna ruhusa (Unauthorized). Tafadhali ingia kwenye akaunti yako tena.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    // 2. Read the secret Gemini Key from Supabase Environment Secrets
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
       throw new Error("GEMINI_API_KEY haipo kwenye Supabase Secrets")
    }

    // 3. Parse user request body
    const body = await req.json()
    const { action, payload } = body

    if (!action || !payload) {
        throw new Error("Tafadhali weka 'action' na 'payload' kwenye request body yako.")
    }

    // 4. Initialize Gemini via npm module
    const ai = new GoogleGenAI({ apiKey })

    // 5. Proxy the generateContent request
    if (action === 'generateContent') {
      const response = await ai.models.generateContent(payload)
      return new Response(JSON.stringify({ text: response.text }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    } 
    
    // In case there are other actions in the future, return 400
    return new Response(JSON.stringify({ error: 'Action hii haitambuliki (' + action + ')' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})