import { HomeView } from "@/modules/home/home-view"
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

const Page = async ()=>{
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if(!session){
    redirect("/auth/sign-in");
  }

  return <HomeView/>
}
export default Page;