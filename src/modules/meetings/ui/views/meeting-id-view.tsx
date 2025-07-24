"use client";

import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { useTRPC } from "@/trpc/client";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { MeetingIdViewHeader } from "../components/meeting-id-view-header";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/hooks/use-confirm";
import { useState } from "react";
import { UpdateMeetingDialog } from "../components/update-meeting-dialog";

interface Props{
    meetingId:string;
}

export const MeetingIdView = ({ meetingId }:Props) =>{
    const router = useRouter();
    const queryClient= useQueryClient();
    const trpc = useTRPC();
    const { data } = useSuspenseQuery(
        trpc.meetings.getOne.queryOptions({ id:meetingId }),
    );

    const [updateMeetingDialogOpen,setUpdateMeetingDialogOpen] = useState(false);

    const [RemoveConfirmation,confirmRemove] = useConfirm(
            "Are you sure?",
            `The following action will remove this meetings.`
        );

    const removeMeeting = useMutation(
        trpc.meetings.remove.mutationOptions({
            onSuccess:()=>{
                queryClient.invalidateQueries(trpc.meetings.getmany.queryOptions({}));
                router.push("/meetings");
            },
        }),
    );

    const handleRemoveMeeting = async()=>{
        const ok = await confirmRemove();

        if(!ok) return;
        
        await removeMeeting.mutateAsync({ id:meetingId })
    };

    return(
        <>
        <RemoveConfirmation />
        <UpdateMeetingDialog
        open={updateMeetingDialogOpen}
        onOpenChange={setUpdateMeetingDialogOpen}
        initialValues={data}
        />
        <div className="flex-1 py-4 px-4 md:px-8 flex flex-col gap-y-4">
            <MeetingIdViewHeader 
            meetingId={meetingId}
            meetingName={data.name}
            onEdit={()=>setUpdateMeetingDialogOpen(true)}
            onRemove={handleRemoveMeeting}
            />
            {JSON.stringify(data,null,2)}
        </div>
        </>
    )
};

export const MeetingsIdViewLoading = ()=>{
    return(
        <LoadingState title="Loading Meeting"
        description="This may take a fews seconds"
        />
    );
};

export const MeetingsIdViewError = () =>{
    return(
        <ErrorState
                title="Error Loading Metting"
                description="Something went wrong"
        />
    )
}

